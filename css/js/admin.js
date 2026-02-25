
const BASE_URL = ""; // "" = mesmo domínio (Render). Se separar front/back, coloque a URL aqui.
const TOKEN_KEY = "admin_token_v1";

function $(id) {
  return document.getElementById(id);
}

function setMsg(text, type) {
  const el = $("msg");
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg" + (type ? ` ${type}` : "");
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// ===================== LOGIN =====================

async function adminLogin() {
  console.log("Clique detectado: adminLogin disparou");
  const emailEl = $("email");
  const passEl = $("password");

  const email = (emailEl?.value || "").trim();
  const password = passEl?.value || "";

  if (!email || !password) return setMsg("Informe email e senha.", "err");

  try {
    const r = await fetch(`${BASE_URL}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || `Falha no login (${r.status})`);

    // ✅ pega o token mesmo se o backend usar outro nome
    const token = data.token || data.accessToken || data.jwt;
    if (!token) throw new Error("Login OK, mas nenhum token foi retornado pelo servidor.");

    saveToken(token);
    setMsg("Login ok. Redirecionando...", "ok");

    // ✅ use a página que realmente existe
    window.location.href = "/admin.html"; // <- ajuste para o nome real do seu arquivo
  } catch (e) {
    setMsg(e.message, "err");
  }
}

// ===================== FORMATOS =====================
// Trata data como YYYY-MM-DD (evita bug de timezone/UTC)
function fmtDateBR(isoOrDate) {
  if (!isoOrDate) return "";
  const s = String(isoOrDate).slice(0, 10); // YYYY-MM-DD
  const parts = s.split("-");
  if (parts.length !== 3) return s;
  const [yyyy, mm, dd] = parts;
  return `${dd}/${mm}/${yyyy}`;
}

function fmtTimeHHMM(t) {
  return String(t || "").slice(0, 5);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ===================== LISTAGEM ADMIN =====================
async function fetchAppointments() {
  const token = getToken();
  if (!token) {
    window.location.href = "/admin/login";
    return;
  }

  const date = $("date")?.value || "";
  const status = $("status")?.value || "";
  const phone = $("phone")?.value || "";

  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (status) params.set("status", status);
  if (phone) params.set("phone", phone);

  setMsg("Carregando...", "");

  try {
    const r = await fetch(`${BASE_URL}/admin/appointments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

    if (r.status === 401) {
      clearToken();
      window.location.href = "/admin/login";
      return;
    }

    if (!r.ok) throw new Error(data.error || `Erro (${r.status})`);

    const rows = Array.isArray(data) ? data : [];
    renderTable(rows);
    setMsg(`Total: ${rows.length}`, "ok");
  } catch (e) {
    setMsg(e.message, "err");
  }
}

function renderTable(rows) {
  const wrap = $("tableWrap");
  if (!wrap) return;

  if (!rows.length) {
    wrap.innerHTML = "<p>Nenhum agendamento encontrado.</p>";
    return;
  }

  const html = `
    <table style="width:100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align:left; padding:8px;">ID</th>
          <th style="text-align:left; padding:8px;">Status</th>
          <th style="text-align:left; padding:8px;">Serviço</th>
          <th style="text-align:left; padding:8px;">Data</th>
          <th style="text-align:left; padding:8px;">Hora</th>
          <th style="text-align:left; padding:8px;">Paciente</th>
          <th style="text-align:left; padding:8px;">Telefone</th>
          <th style="text-align:left; padding:8px;">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr>
            <td style="padding:8px;">${r.id}</td>

            <td style="padding:8px;">
              ${
                r.status === "CONFIRMED"
                  ? `<span style="color:#22c55e; font-weight:600;">Confirmado</span>`
                  : `<span style="color:#ef4444; font-weight:600;">Cancelado</span>`
              }
            </td>

            <td style="padding:8px;">
              ${escapeHtml(r.service_name)} (${escapeHtml(r.location)})
            </td>

            <td style="padding:8px;">
              ${escapeHtml(fmtDateBR(r.slot_date))}
            </td>

            <td style="padding:8px;">
              ${escapeHtml(fmtTimeHHMM(r.slot_time))}
            </td>

            <td style="padding:8px;">
              ${escapeHtml(r.patient_name)}
            </td>

            <td style="padding:8px;">
              ${escapeHtml(r.patient_phone)}
            </td>

            <td style="padding:8px;">
              ${
                r.status === "CANCELED"
                  ? `<button 
                      data-delete="${r.id}" 
                      type="button"
                      style="background:#ef4444;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;">
                      Excluir
                    </button>`
                  : `<button 
                      data-cancel="${r.id}" 
                      type="button"
                      style="background:#f97316;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;">
                      Cancelar
                    </button>`
              }
            </td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;

  wrap.innerHTML = html;

  // bind cancelar
  wrap.querySelectorAll("button[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () =>
      cancelAppointment(btn.getAttribute("data-cancel"))
    );
  });

  // bind excluir
  wrap.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () =>
      deleteAppointment(btn.getAttribute("data-delete"))
    );
  });
}

// ===================== AÇÕES ADMIN =====================
async function cancelAppointment(id) {
  const token = getToken();
  if (!token) return (window.location.href = "/admin/login");

  if (!confirm(`Cancelar agendamento #${id}?`)) return;

  try {
    const r = await fetch(`${BASE_URL}/admin/appointments/${id}/cancel`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

    if (r.status === 401) {
      clearToken();
      window.location.href = "/admin/login";
      return;
    }

    if (!r.ok) throw new Error(data.error || `Erro ao cancelar (${r.status})`);

    setMsg(`Agendamento #${id} cancelado.`, "ok");
    await fetchAppointments();
  } catch (e) {
    setMsg(e.message, "err");
  }
}

async function deleteAppointment(id) {
  const token = getToken();
  if (!token) return (window.location.href = "/admin/login");

  if (!confirm(`Excluir DEFINITIVAMENTE o agendamento #${id}?`)) return;

  try {
    const r = await fetch(`${BASE_URL}/admin/appointments/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await r.json().catch(() => ({}));

    if (r.status === 401) {
      clearToken();
      window.location.href = "/admin/login";
      return;
    }

    if (!r.ok) throw new Error(data.error || `Erro ao excluir (${r.status})`);

    setMsg(`Agendamento #${id} excluído.`, "ok");
    await fetchAppointments();
  } catch (e) {
    setMsg(e.message, "err");
  }
}

// ===================== INIT PÁGINAS =====================
function initLoginPage() {
  const btn = $("loginBtn");
  if (!btn) return;

  btn.addEventListener("click", adminLogin);

  const emailEl = $("email");
  const passEl = $("password");

  emailEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") adminLogin();
  });

  passEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") adminLogin();
  });
}

function initAdminPage() {
  const logoutBtn = $("logoutBtn");
  const searchBtn = $("searchBtn");
  const clearBtn = $("clearBtn");

  // Se não existe a UI do admin, não roda (evita quebrar na página de login)
  if (!logoutBtn || !searchBtn || !clearBtn) return;

  logoutBtn.addEventListener("click", () => {
    clearToken();
    window.location.href = "/admin/login";
  });

  searchBtn.addEventListener("click", fetchAppointments);

  clearBtn.addEventListener("click", () => {
    if ($("date")) $("date").value = "";
    if ($("status")) $("status").value = "";
    if ($("phone")) $("phone").value = "";
    fetchAppointments();
  });

  fetchAppointments();
}

// ===================== NOVO AGENDAMENTO (ADMIN) =====================
const newServiceSelect = document.getElementById("newServiceSelect");
const newDateInput = document.getElementById("newDateInput");
const newLoadSlotsBtn = document.getElementById("newLoadSlotsBtn");
const newSlotsArea = document.getElementById("newSlotsArea");

const newPatientName = document.getElementById("newPatientName");
const newPatientPhone = document.getElementById("newPatientPhone");
const newNotes = document.getElementById("newNotes");

const newChosenSlotText = document.getElementById("newChosenSlotText");
const newCreateBtn = document.getElementById("newCreateBtn");
const newMsg = document.getElementById("newMsg");

let newChosenSlot = null;

function setNewMsg(text, type) {
  if (!newMsg) return;
  newMsg.textContent = text || "";
  newMsg.className = "msg" + (type ? ` ${type}` : "");
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addMonthsISO(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resetNewSlots() {
  if (!newSlotsArea) return;
  newSlotsArea.innerHTML = "";
  newChosenSlot = null;
  if (newChosenSlotText) newChosenSlotText.textContent = "Nenhum";
  if (newCreateBtn) newCreateBtn.disabled = true;
}

function updateNewLoadSlotsState() {
  if (!newLoadSlotsBtn) return;
  const ok = !!newServiceSelect?.value && !!newDateInput?.value;
  newLoadSlotsBtn.disabled = !ok;
}

async function loadServicesForAdminNew() {
  if (!newServiceSelect) return;

  setNewMsg("");
  newServiceSelect.innerHTML = `<option value="">Carregando...</option>`;

  try {
    const r = await fetch(`${BASE_URL}/services`);
    if (!r.ok) throw new Error(`Erro ao listar serviços (${r.status})`);
    const data = await r.json();

    newServiceSelect.innerHTML = `<option value="">Selecione um serviço</option>`;
    for (const s of data) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.duration_minutes || 60} min) - ${s.location || "Local"}`;
      newServiceSelect.appendChild(opt);
    }

    updateNewLoadSlotsState();
  } catch (e) {
    newServiceSelect.innerHTML = `<option value="">Falha ao carregar serviços</option>`;
    setNewMsg(e.message, "err");
    updateNewLoadSlotsState();
  }
}

async function loadSlotsForAdminNew() {
  if (!newServiceSelect || !newDateInput || !newSlotsArea) return;

  setNewMsg("");
  resetNewSlots();

  const serviceId = newServiceSelect.value;
  const date = newDateInput.value;

  if (!serviceId) return setNewMsg("Selecione um serviço.", "err");
  if (!date) return setNewMsg("Selecione uma data.", "err");

  if (date < newDateInput.min || date > newDateInput.max) {
    return setNewMsg("Data fora do intervalo permitido (até 3 meses).", "err");
  }

  try {
    const r = await fetch(`${BASE_URL}/services/${serviceId}/slots?date=${date}`);
    if (!r.ok) throw new Error(`Erro ao buscar horários (${r.status})`);
    const data = await r.json();

    if (!Array.isArray(data) || data.length === 0) {
      return setNewMsg("Nenhum horário disponível para esta data.", "err");
    }

    for (const slot of data) {
      const slotId = slot.id;
      const rawTime = slot.slot_time ?? "";
      const time = String(rawTime).slice(0, 5);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.textContent = time;

      btn.addEventListener("click", () => {
        newSlotsArea.querySelectorAll(".slot").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        newChosenSlot = { slot_id: slotId, time, date };
        if (newChosenSlotText) newChosenSlotText.textContent = `${date} às ${time}`;
        if (newCreateBtn) newCreateBtn.disabled = false;
      });

      newSlotsArea.appendChild(btn);
    }
  } catch (e) {
    setNewMsg(e.message, "err");
  }
}

async function createAppointmentAsAdmin() {
  const token = getToken();
  if (!token) return (window.location.href = "/admin/login");

  setNewMsg("");

  if (!newChosenSlot) return setNewMsg("Escolha um horário antes de criar.", "err");

  const name = (newPatientName?.value || "").trim();
  const phone = (newPatientPhone?.value || "").trim();
  const notes = (newNotes?.value || "").trim();

  if (!name) return setNewMsg("Informe o nome do paciente.", "err");

  const onlyDigits = phone.replace(/\D/g, "");
  if (onlyDigits.length < 10) {
    return setNewMsg("Telefone inválido. Use DDD + número.", "err");
  }

  if (newCreateBtn) newCreateBtn.disabled = true;

  try {
    const payload = {
      slot_id: newChosenSlot.slot_id,
      patient_name: name,
      patient_phone: phone,
      notes,
    };

    const r = await fetch(`${BASE_URL}/admin/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    if (r.status === 401) {
      clearToken();
      window.location.href = "/admin/login";
      return;
    }

    if (!r.ok) throw new Error(data.error || `Falha ao criar (${r.status})`);

    setNewMsg("Agendamento criado com sucesso!", "ok");

    if (newPatientName) newPatientName.value = "";
    if (newPatientPhone) newPatientPhone.value = "";
    if (newNotes) newNotes.value = "";
    resetNewSlots();

    await fetchAppointments();
  } catch (e) {
    setNewMsg(e.message, "err");
    if (newCreateBtn) newCreateBtn.disabled = false;
  }
}

// máscara telefone (admin novo)
if (newPatientPhone) {
  newPatientPhone.addEventListener("input", () => {
    let v = newPatientPhone.value.replace(/\D/g, "").slice(0, 11);
    if (v.length >= 2) v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
    if (v.length > 10) v = v.replace(/(\(\d{2}\)\s\d{5})(\d+)/, "$1-$2");
    else v = v.replace(/(\(\d{2}\)\s\d{4})(\d+)/, "$1-$2");
    newPatientPhone.value = v;
  });
}

(function initAdminNewAppointmentCard() {
  if (!newServiceSelect || !newDateInput || !newLoadSlotsBtn || !newCreateBtn) return;

  newDateInput.min = todayISO();
  newDateInput.max = addMonthsISO(3);
  newDateInput.value = todayISO();

  loadServicesForAdminNew();
  updateNewLoadSlotsState();

  newLoadSlotsBtn.addEventListener("click", loadSlotsForAdminNew);
  newCreateBtn.addEventListener("click", createAppointmentAsAdmin);

  newServiceSelect.addEventListener("change", () => {
    resetNewSlots();
    updateNewLoadSlotsState();
  });

  newDateInput.addEventListener("change", () => {
    resetNewSlots();
    updateNewLoadSlotsState();
  });
})();

// ===================== START =====================
initLoginPage();
initAdminPage();
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("loginBtn");
  if (btn) btn.addEventListener("click", adminLogin);

  // opcional: Enter no campo senha
  const pass = document.getElementById("password");
  if (pass) {
    pass.addEventListener("keydown", (e) => {
      if (e.key === "Enter") adminLogin();
    });
  }
});