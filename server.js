require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());
app.get("/health", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW() as now");
    res.json({
      status: "ok",
      database: "conectado",
      time: result.rows[0].now
    });
  } catch (err) {
    res.status(500).json({
      status: "erro",
      message: err.message
    });
  }
});
// ===== CRIAR ADMIN AUTOMATICAMENTE =====
async function ensureAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const pass = process.env.ADMIN_PASSWORD;

  if (!email || !pass) {
    console.log("⚠️ ADMIN_EMAIL ou ADMIN_PASSWORD não definidos no .env");
    return;
  }

  try {
    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rowCount > 0) {
      console.log("Admin já existe.");
      return;
    }

    const hash = await bcrypt.hash(pass, 10);

    await db.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
      [email, hash]
    );

    console.log("✅ Admin criado:", email);
  } catch (err) {
    console.error("Erro ao criar admin:", err.message);
  }
}

ensureAdminUser();

//STATIC conforme sua estrutura atual:
// pasta "css" na raiz, contendo:
// - css/agendar.css
// - css/js/agendar.js
app.use("/css", express.static(path.join(__dirname, "css")));

// health
app.get("/health", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW() as now");
    res.json({ status: "ok", time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 1) listar serviços
app.get("/services", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT id, name, duration_minutes, location FROM services ORDER BY id"
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  NOVO: primeira e última data de slot por serviço
app.get("/services/:id/date-range", async (req, res) => {
  const serviceId = Number(req.params.id);
  if (!serviceId) return res.status(400).json({ error: "Informe :id" });

  try {
    const r = await db.query(
      `
      SELECT 
        MIN(slot_date) AS min_date,
        MAX(slot_date) AS max_date
      FROM slots
      WHERE service_id = $1
      `,
      [serviceId]
    );

    res.json(r.rows[0]); // { min_date, max_date }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2) horários livres por serviço e data
app.get("/services/:id/slots", async (req, res) => {
  const serviceId = Number(req.params.id);
  const { date } = req.query;


  if (!serviceId || !date) {
    return res.status(400).json({ error: "Informe :id e date=YYYY-MM-DD" });
  }

  try {
    const r = await db.query(
      `
      SELECT sl.id, sl.slot_time
      FROM slots sl
      LEFT JOIN appointments ap
        ON ap.slot_id = sl.id AND ap.status NOT IN ('CANCELED')
      WHERE sl.service_id = $1
        AND sl.slot_date = $2
        AND sl.available = TRUE
        AND ap.id IS NULL
      ORDER BY sl.slot_time
      `,
      [serviceId, date]
    );

    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3) criar agendamento (com transação)
// 3) criar agendamento (com transação)
app.post("/appointments", async (req, res) => {
  const { slot_id, patient_name, patient_phone, notes } = req.body;

  if (!slot_id || !patient_name || !patient_phone) {
    return res.status(400).json({
      error: "Campos obrigatórios: slot_id, patient_name, patient_phone",
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const slot = await client.query(
      `SELECT id, available
       FROM slots
       WHERE id = $1
       FOR UPDATE`,
      [slot_id]
    );

    if (slot.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Slot não encontrado" });
    }

    if (!slot.rows[0].available) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Horário indisponível" });
    }

    const exists = await client.query(
      `SELECT 1 FROM appointments
       WHERE slot_id = $1 AND status NOT IN ('CANCELED')
       LIMIT 1`,
      [slot_id]
    );

    if (exists.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Horário já foi agendado" });
    }

    const created = await client.query(
      `
      INSERT INTO appointments (slot_id, patient_name, patient_phone, notes, status)
      VALUES ($1, $2, $3, $4, 'CONFIRMED')
      RETURNING id, slot_id, patient_name, patient_phone, notes, status, created_at
      `,
      [slot_id, patient_name, patient_phone, notes || null]
    );

    await client.query(
      `UPDATE slots SET available = FALSE WHERE id = $1`,
      [slot_id]
    );

    await client.query("COMMIT");
    return res.status(201).json(created.rows[0]);

  } catch (err) {
    await client.query("ROLLBACK");

    //  Tratamento específico para erro de UNIQUE (Postgres)
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Horário já foi agendado. Atualize a página e escolha outro horário."
      });
    }

    return res.status(500).json({ error: err.message });

  } finally {
    client.release();
  }
});


// página do agendamento
app.get("/agendar", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "agendar.html"));
});
// 4) listar agendamentos por telefone (padrão: próximos 3 meses)
app.get("/appointments", async (req, res) => {
  const { phone, from, to } = req.query;

  if (!phone) return res.status(400).json({ error: "Informe phone" });

  // normaliza para comparar só dígitos
  const phoneDigits = String(phone).replace(/\D/g, "");

  // intervalo padrão: hoje até +3 meses (se não vier from/to)
  // OBS: usamos o banco pra calcular datas
  try {
    const r = await db.query(
      `
      SELECT 
        ap.id,
        ap.status,
        ap.patient_name,
        ap.patient_phone,
        ap.notes,
        ap.created_at,
        sl.id AS slot_id,
        sl.slot_date,
        sl.slot_time,
        sv.id AS service_id,
        sv.name AS service_name,
        sv.duration_minutes,
        sv.location
      FROM appointments ap
      JOIN slots sl ON sl.id = ap.slot_id
      JOIN services sv ON sv.id = sl.service_id
      WHERE regexp_replace(ap.patient_phone, '\\D', '', 'g') = $1
        AND ap.status NOT IN ('CANCELED')
        AND sl.slot_date >= COALESCE($2::date, CURRENT_DATE)
        AND sl.slot_date <= COALESCE($3::date, (CURRENT_DATE + INTERVAL '3 months')::date)
      ORDER BY sl.slot_date ASC, sl.slot_time ASC
      `,
      [phoneDigits, from || null, to || null]
    );

    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// 5) cancelar agendamento (status + libera slot)
app.patch("/appointments/:id/cancel", async (req, res) => {
  const appointmentId = Number(req.params.id);
  if (!appointmentId) return res.status(400).json({ error: "Informe :id" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const ap = await client.query(
      `
      SELECT id, slot_id, status
      FROM appointments
      WHERE id = $1
      FOR UPDATE
      `,
      [appointmentId]
    );

    if (ap.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    if (ap.rows[0].status === "CANCELED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Agendamento já está cancelado" });
    }

    const slotId = ap.rows[0].slot_id;

    await client.query(
      `UPDATE appointments SET status = 'CANCELED' WHERE id = $1`,
      [appointmentId]
    );

    await client.query(
      `UPDATE slots SET available = TRUE WHERE id = $1`,
      [slotId]
    );

    await client.query("COMMIT");
    res.json({ ok: true, canceled_id: appointmentId });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
// 6) reagendar: cancela antigo + cria novo agendamento no novo slot
app.post("/appointments/reschedule", async (req, res) => {
  const { appointment_id, new_slot_id } = req.body;

  if (!appointment_id || !new_slot_id) {
    return res.status(400).json({
      error: "Campos obrigatórios: appointment_id, new_slot_id",
    });
  }

  const appointmentId = Number(appointment_id);
  const newSlotId = Number(new_slot_id);

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: "appointment_id inválido" });
  }
  if (!Number.isInteger(newSlotId) || newSlotId <= 0) {
    return res.status(400).json({ error: "new_slot_id inválido" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // trava o agendamento antigo
    const oldAp = await client.query(
      `
      SELECT id, slot_id, patient_name, patient_phone, notes, status
      FROM appointments
      WHERE id = $1
      FOR UPDATE
      `,
      [appointmentId]
    );

    if (oldAp.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Agendamento antigo não encontrado" });
    }

    if (oldAp.rows[0].status === "CANCELED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Agendamento antigo já está cancelado" });
    }

    const oldSlotId = oldAp.rows[0].slot_id;

    if (oldSlotId === newSlotId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Novo horário deve ser diferente do atual" });
    }

    // trava o slot antigo (pra garantir liberação segura)
    const oldSlot = await client.query(
      `
      SELECT id
      FROM slots
      WHERE id = $1
      FOR UPDATE
      `,
      [oldSlotId]
    );

    if (oldSlot.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Slot antigo não encontrado" });
    }

    // trava o novo slot
    const newSlot = await client.query(
      `
      SELECT id, available
      FROM slots
      WHERE id = $1
      FOR UPDATE
      `,
      [newSlotId]
    );

    if (newSlot.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Novo horário (slot) não encontrado" });
    }

    if (!newSlot.rows[0].available) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Novo horário indisponível" });
    }

    // garante que não tem appointment ativo no novo slot
    const exists = await client.query(
      `
      SELECT 1
      FROM appointments
      WHERE slot_id = $1 AND status NOT IN ('CANCELED')
      LIMIT 1
      `,
      [newSlotId]
    );

    if (exists.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Novo horário já foi agendado" });
    }

    // cancela o antigo e libera slot antigo
    await client.query(`UPDATE appointments SET status = 'CANCELED' WHERE id = $1`, [appointmentId]);
    await client.query(`UPDATE slots SET available = TRUE WHERE id = $1`, [oldSlotId]);

    // cria o novo e ocupa o slot novo
    const created = await client.query(
      `
      INSERT INTO appointments (slot_id, patient_name, patient_phone, notes, status)
      VALUES ($1, $2, $3, $4, 'CONFIRMED')
      RETURNING id, slot_id, patient_name, patient_phone, notes, status, created_at
      `,
      [
        newSlotId,
        oldAp.rows[0].patient_name,
        oldAp.rows[0].patient_phone,
        oldAp.rows[0].notes || null,
      ]
    );

    await client.query(`UPDATE slots SET available = FALSE WHERE id = $1`, [newSlotId]);

    await client.query("COMMIT");
    return res.status(201).json({
      ok: true,
      canceled_id: appointmentId,
      new_appointment: created.rows[0],
    });

  } catch (err) {
    await client.query("ROLLBACK");

    // Postgres unique violation (ex.: UNIQUE(slot_id) ou índice parcial)
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Novo horário já foi agendado. Atualize e tente outro.",
      });
    }

    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
// ================== ADMIN AUTH + ROTAS ADMIN ==================
console.log("Registrando rotas admin...");

function authAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token não enviado" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2) {
    return res.status(401).json({ error: "Token inválido" });
  }

  const [scheme, token] = parts;

  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ error: "Formato do token inválido" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "admin") {
      return res.status(403).json({ error: "Sem permissão" });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

// LOGIN ADMIN
app.post("/admin/login", async (req, res) => {
  console.log("🔑 POST /admin/login chamado");
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Informe email e password" });
  }

  try {
    const result = await db.query(
      "SELECT id, email, password_hash, role FROM users WHERE email = $1",
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = result.rows[0];

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = jwt.sign(
      { user_id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
// ================= ADMIN: LISTAR AGENDAMENTOS =================
// (por padrão NÃO mostra datas passadas)
app.get("/admin/appointments", authAdmin, async (req, res) => {
  console.log("📋 GET /admin/appointments chamado");
  const { date, from, to, status, phone } = req.query;

  try {
    const r = await db.query(
      `
      SELECT 
        ap.id,
        ap.status,
        ap.patient_name,
        ap.patient_phone,
        ap.notes,
        ap.created_at,
        sl.slot_date,
        sl.slot_time,
        sv.id AS service_id,
        sv.name AS service_name,
        sv.location
      FROM appointments ap
      JOIN slots sl ON sl.id = ap.slot_id
      JOIN services sv ON sv.id = sl.service_id
      WHERE 1=1
        --  some com datas passadas
        AND sl.slot_date >= CURRENT_DATE

        AND ($1::date IS NULL OR sl.slot_date = $1::date)
        AND ($2::date IS NULL OR sl.slot_date >= $2::date)
        AND ($3::date IS NULL OR sl.slot_date <= $3::date)
        AND ($4::text IS NULL OR ap.status = $4::text)
        AND ($5::text IS NULL OR regexp_replace(ap.patient_phone, '\\D', '', 'g') = regexp_replace($5, '\\D', '', 'g'))
      ORDER BY sl.slot_date ASC, sl.slot_time ASC
      `,
      [date || null, from || null, to || null, status || null, phone || null]
    );

    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// ================= ADMIN: CANCELAR AGENDAMENTO =================
app.patch("/admin/appointments/:id/cancel", authAdmin, async (req, res) => {
  const appointmentId = Number(req.params.id);
  if (!appointmentId) return res.status(400).json({ error: "Informe :id" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const ap = await client.query(
      `
      SELECT id, slot_id, status
      FROM appointments
      WHERE id = $1
      FOR UPDATE
      `,
      [appointmentId]
    );

    if (ap.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    if (ap.rows[0].status === "CANCELED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Agendamento já está cancelado" });
    }

    const slotId = ap.rows[0].slot_id;

    await client.query(
      `UPDATE appointments SET status = 'CANCELED' WHERE id = $1`,
      [appointmentId]
    );

    await client.query(
      `UPDATE slots SET available = TRUE WHERE id = $1`,
      [slotId]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, canceled_id: appointmentId });

  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ================= ADMIN: EXCLUIR DEFINITIVO =================
app.delete("/admin/appointments/:id", authAdmin, async (req, res) => {
  const appointmentId = Number(req.params.id);
  if (!appointmentId) return res.status(400).json({ error: "Informe :id" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const ap = await client.query(
      `SELECT id, slot_id, status
       FROM appointments
       WHERE id = $1
       FOR UPDATE`,
      [appointmentId]
    );

    if (ap.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    if (ap.rows[0].status !== "CANCELED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Só pode excluir cancelados" });
    }

    const slotId = ap.rows[0].slot_id;

    await client.query(`DELETE FROM appointments WHERE id = $1`, [appointmentId]);
    await client.query(`UPDATE slots SET available = TRUE WHERE id = $1`, [slotId]);

    await client.query("COMMIT");
    return res.json({ ok: true, deleted_id: appointmentId });

  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ================= ADMIN: CRIAR AGENDAMENTO =================
app.post("/admin/appointments", authAdmin, async (req, res) => {
  const { slot_id, patient_name, patient_phone, notes } = req.body;

  if (!slot_id || !patient_name || !patient_phone) {
    return res.status(400).json({
      error: "Campos obrigatórios: slot_id, patient_name, patient_phone",
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const slot = await client.query(
      `SELECT id, available FROM slots WHERE id = $1 FOR UPDATE`,
      [slot_id]
    );

    if (slot.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Slot não encontrado" });
    }

    if (!slot.rows[0].available) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Horário indisponível" });
    }

    const exists = await client.query(
      `SELECT 1 FROM appointments WHERE slot_id = $1 AND status NOT IN ('CANCELED') LIMIT 1`,
      [slot_id]
    );

    if (exists.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Horário já foi agendado" });
    }

    const created = await client.query(
      `
      INSERT INTO appointments (slot_id, patient_name, patient_phone, notes, status)
      VALUES ($1, $2, $3, $4, 'CONFIRMED')
      RETURNING id, slot_id, patient_name, patient_phone, notes, status, created_at
      `,
      [slot_id, patient_name, patient_phone, notes || null]
    );

    await client.query(`UPDATE slots SET available = FALSE WHERE id = $1`, [slot_id]);

    await client.query("COMMIT");
    return res.status(201).json(created.rows[0]);

  } catch (err) {
    await client.query("ROLLBACK");

    //  Postgres unique violation
    if (err.code === "23505") {
      return res.status(409).json({ error: "Horário já foi agendado. Atualize e tente outro." });
    }

    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ================= PÁGINAS ADMIN =================
app.get("/admin/login", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "admin-login.html"));
});

app.get("/admin", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "admin.html"));
});

console.log( "Rotas admin registradas");

// HOME do Render
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "agendar.html"));
});
// ================= START SERVER =================
app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando na porta", process.env.PORT || 3000);
});

