const BASE_URL = "";
console.log("AGENDAR.JS ATUALIZADO - syncDateToServiceRange + resultado + excluir");

const serviceSelect = document.getElementById("serviceSelect");
const dateInput = document.getElementById("dateInput");
const loadSlotsBtn = document.getElementById("loadSlotsBtn");
const slotsArea = document.getElementById("slotsArea");

const patientName = document.getElementById("patientName");
const patientPhone = document.getElementById("patientPhone");
const notes = document.getElementById("notes");

const chosenSlotText = document.getElementById("chosenSlotText");
const confirmBtn = document.getElementById("confirmBtn");
const msg = document.getElementById("msg");

let chosenSlot = null;
let didSuggestMinDate = false;

// ===== estado do último agendamento exibido =====
const LAST_APPOINTMENT_KEY = "last_appointment_v1";
let lastAppointment = null; // { appointment_id, slot_id, service_id, service_label, date, time, patient_name, patient_phone }

let resultBoxEl = null; // container criado via JS

function setMsg(text, type) {
  msg.textContent = text || "";
  msg.className = "msg" + (type ? ` ${type}` : "");
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

function resetSlots() {
  slotsArea.innerHTML = "";
  chosenSlot = null;
  chosenSlotText.textContent = "Nenhum";
  confirmBtn.disabled = true;
}

function updateLoadSlotsState() {
  const ok = !!serviceSelect.value && !!dateInput.value;
  loadSlotsBtn.disabled = !ok;
}

function getSelectedServiceLabel() {
  const opt = serviceSelect.options[serviceSelect.selectedIndex];
  return opt ? opt.textContent : "";
}

// ===== cria/atualiza um "card" do resultado =====
function ensureResultBox() {
  if (resultBoxEl) return resultBoxEl;

  resultBoxEl = document.createElement("div");
  resultBoxEl.id = "resultBox";
  resultBoxEl.className = "result-box";

  // coloca logo após o <p id="msg">
  msg.insertAdjacentElement("afterend", resultBoxEl);
  return resultBoxEl;
}

function clearResultBox() {
  if (!resultBoxEl) return;
  resultBoxEl.innerHTML = "";
}

function saveLastAppointment(ap) {
  lastAppointment = ap;
  try {
    localStorage.setItem(LAST_APPOINTMENT_KEY, JSON.stringify(ap));
  } catch {}
}

function loadLastAppointmentFromStorage() {
  try {
    const raw = localStorage.getItem(LAST_APPOINTMENT_KEY);
    if (!raw) return null;
    const ap = JSON.parse(raw);
    if (!ap || !ap.appointment_id) return null;
    return ap;
  } catch {
    return null;
  }
}

function removeLastAppointmentFromStorage() {
  lastAppointment = null;
  try {
    localStorage.removeItem(LAST_APPOINTMENT_KEY);
  } catch {}
}

// ===== CARD: só botão EXCLUIR =====
function renderAppointmentCard(ap) {
  const box = ensureResultBox();
  const safe = (v) => (v == null ? "" : String(v));

  box.innerHTML = `
    <div class="card" style="margin-top:12px;">
      <h2 style="margin:0 0 8px 0;">✅ Agendamento realizado</h2>

      <div style="line-height:1.6;">
        <div><strong>ID:</strong> ${safe(ap.appointment_id)}</div>
        <div><strong>Serviço:</strong> ${safe(ap.service_label)}</div>
        <div><strong>Data/Hora:</strong> ${safe(ap.date)} às ${safe(ap.time)}</div>
        <div><strong>Paciente:</strong> ${safe(ap.patient_name)}</div>
        <div><strong>Telefone:</strong> ${safe(ap.patient_phone)}</div>
      </div>

      <div class="row" style="margin-top:12px;">
        <button id="btnCancelAppt" type="button">Excluir (cancelar)</button>
      </div>

      <p id="resultHint" class="msg" style="margin-top:10px;"></p>
    </div>
  `;

  const btnCancel = document.getElementById("btnCancelAppt");
  const hint = document.getElementById("resultHint");

  btnCancel.addEventListener("click", async () => {
    if (!confirm("Tem certeza que deseja cancelar este agendamento?")) return;

    btnCancel.disabled = true;

    try {
      const r = await fetch(`${BASE_URL}/appointments/${ap.appointment_id}/cancel`, {
        method: "PATCH"
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || data.message || `Falha ao cancelar (${r.status})`);

      setMsg("Agendamento cancelado com sucesso.", "ok");
      hint.textContent = "Cancelado. Você pode escolher um novo horário e agendar novamente.";
      hint.className = "msg ok";

      // limpa storage e UI do resultado
      removeLastAppointmentFromStorage();
      clearResultBox();

      // atualiza horários (slot volta a ficar disponível)
      resetSlots();
      if (serviceSelect.value && dateInput.value) {
        await loadSlots();
      }
    } catch (e) {
      setMsg(e.message, "err");
      btnCancel.disabled = false;
    }
  });
}

// ===== existente: syncDateToServiceRange =====
async function syncDateToServiceRange() {
  const serviceId = serviceSelect.value;
  if (!serviceId) return;

  try {
    const r = await fetch(`${BASE_URL}/services/${serviceId}/date-range`);
    if (!r.ok) return;

    const range = await r.json();
    const minDate = range.min_date ? String(range.min_date).slice(0, 10) : null;
    if (!minDate) return;

    // só sugere UMA vez, e apenas se estiver em "hoje" e hoje < minDate
    if (!didSuggestMinDate) {
      const today = todayISO();
      if (dateInput.value === today && today < minDate) {
        dateInput.value = minDate;
      }
      didSuggestMinDate = true;
    }
  } catch {
    // ignora
  }
}

async function loadServices() {
  setMsg("");
  serviceSelect.innerHTML = `<option value="">Carregando...</option>`;

  try {
    const r = await fetch(`${BASE_URL}/services`);
    if (!r.ok) throw new Error(`Erro ao listar serviços (${r.status})`);
    const data = await r.json();

    serviceSelect.innerHTML = `<option value="">Selecione um serviço</option>`;
    for (const s of data) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.duration_minutes || 60} min) - ${s.location || "Local"}`;
      serviceSelect.appendChild(opt);
    }

    if (data.length > 0) {
      serviceSelect.value = String(data[0].id);
      didSuggestMinDate = false;
      await syncDateToServiceRange();
    }

    updateLoadSlotsState();
  } catch (e) {
    serviceSelect.innerHTML = `<option value="">Falha ao carregar serviços</option>`;
    setMsg(e.message, "err");
    updateLoadSlotsState();
  }
}

async function loadSlots() {
  setMsg("");
  resetSlots();

  const serviceId = serviceSelect.value;
  const date = dateInput.value;

  if (!serviceId) return setMsg("Selecione um serviço.", "err");
  if (!date) return setMsg("Selecione uma data.", "err");

  // ✅ garante intervalo permitido (hoje até +3 meses)
  if (date < dateInput.min || date > dateInput.max) {
    return setMsg("Data fora do intervalo permitido (até 3 meses).", "err");
  }

  try {
    const r = await fetch(`${BASE_URL}/services/${serviceId}/slots?date=${date}`);
    if (!r.ok) throw new Error(`Erro ao buscar horários (${r.status})`);
    const data = await r.json();

    if (!Array.isArray(data) || data.length === 0) {
      return setMsg("Nenhum horário disponível para esta data.", "err");
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
        document.querySelectorAll(".slot").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        chosenSlot = { slot_id: slotId, time, date };
        chosenSlotText.textContent = `${date} às ${time}`;
        confirmBtn.disabled = false;

        // ✅ leva o usuário pro botão confirmar
        confirmBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      });

      slotsArea.appendChild(btn);
    }
  } catch (e) {
    setMsg(e.message, "err");
  }
}

// ===== CRIAR NORMAL =====
async function createAppointment() {
  setMsg("");

  if (!chosenSlot) return setMsg("Escolha um horário antes de confirmar.", "err");

  const name = patientName.value.trim();
  const phone = patientPhone.value.trim();
  const obs = notes.value.trim();

  if (!name) return setMsg("Informe seu nome.", "err");

  const onlyDigits = phone.replace(/\D/g, "");
  if (onlyDigits.length < 10) {
    return setMsg("Telefone inválido. Use DDD + número.", "err");
  }

  confirmBtn.disabled = true;

  try {
    const payload = {
      slot_id: chosenSlot.slot_id,
      patient_name: name,
      patient_phone: phone,
      notes: obs
    };

    const r = await fetch(`${BASE_URL}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || `Falha ao agendar (${r.status})`);

    setMsg("Agendamento realizado com sucesso!", "ok");

    const ap = {
      appointment_id: data.id,
      slot_id: data.slot_id,
      service_id: Number(serviceSelect.value),
      service_label: getSelectedServiceLabel(),
      date: chosenSlot.date,
      time: chosenSlot.time,
      patient_name: name,
      patient_phone: phone
    };

    saveLastAppointment(ap);
    renderAppointmentCard(ap);

    await loadSlots();

    patientName.value = "";
    patientPhone.value = "";
    notes.value = "";

    confirmBtn.disabled = true;
    chosenSlotText.textContent = "Nenhum";
    chosenSlot = null;
  } catch (e) {
    setMsg(e.message, "err");
    confirmBtn.disabled = false;
  }
}

// máscara telefone
patientPhone.addEventListener("input", () => {
  let v = patientPhone.value.replace(/\D/g, "").slice(0, 11);
  if (v.length >= 2) v = `(${v.slice(0,2)}) ${v.slice(2)}`;
  if (v.length > 10) v = v.replace(/(\(\d{2}\)\s\d{5})(\d+)/, "$1-$2");
  else v = v.replace(/(\(\d{2}\)\s\d{4})(\d+)/, "$1-$2");
  patientPhone.value = v;
});

// INIT: limite de datas (hoje até +3 meses)
dateInput.min = todayISO();
dateInput.max = addMonthsISO(3);
dateInput.value = todayISO();

(async () => {
  await loadServices();
  await syncDateToServiceRange();
  updateLoadSlotsState();

  // restaura último agendamento (se existir)
  const stored = loadLastAppointmentFromStorage();
  if (stored) {
    lastAppointment = stored;
    renderAppointmentCard(stored);
  }
})();

loadSlotsBtn.addEventListener("click", loadSlots);
confirmBtn.addEventListener("click", createAppointment);

serviceSelect.addEventListener("change", async () => {
  resetSlots();
  didSuggestMinDate = false;
  await syncDateToServiceRange();
  updateLoadSlotsState();
});

dateInput.addEventListener("change", () => {
  resetSlots();
  updateLoadSlotsState();
});
