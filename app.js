const state = {
  month: new Date().toISOString().slice(0, 7),
  entries: [],
  summary: [],
};

const $ = (selector) => document.querySelector(selector);

const els = {
  monthInput: $("#monthInput"),
  prevMonth: $("#prevMonth"),
  nextMonth: $("#nextMonth"),
  entryForm: $("#entryForm"),
  entryId: $("#entryId"),
  fecha: $("#fecha"),
  tipo: $("#tipo"),
  cantidad: $("#cantidad"),
  woCm: $("#woCm"),
  nota: $("#nota"),
  abonado: $("#abonado"),
  abonadoDetalle: $("#abonadoDetalle"),
  clearForm: $("#clearForm"),
  formTitle: $("#formTitle"),
  formMessage: $("#formMessage"),
  calendarTitle: $("#calendarTitle"),
  calendarGrid: $("#calendarGrid"),
  entriesList: $("#entriesList"),
  totalHoras: $("#totalHoras"),
  totalExtras: $("#totalExtras"),
  totalCompensar: $("#totalCompensar"),
  totalDiaVale: $("#totalDiaVale"),
  totalAbonados: $("#totalAbonados"),
  noteDialog: $("#noteDialog"),
  noteContent: $("#noteContent"),
};

function formatHours(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString("es-AR", { maximumFractionDigits: 2 })} h`;
}

function displayType(type) {
  const labels = {
    horas_extras: "Horas extras",
    compensar: "A compensar",
    dia_vale_extra: "Dia por vale de extra",
  };
  return labels[type] || type;
}

function monthLabel(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1, 1);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(date);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "No se pudo completar la operacion.");
  }
  return data;
}

async function loadMonth() {
  els.monthInput.value = state.month;
  const query = `month=${encodeURIComponent(state.month)}`;
  const [entries, summary] = await Promise.all([
    api(`/api/registros?${query}`),
    api(`/api/resumen?${query}`),
  ]);
  state.entries = entries;
  state.summary = summary;
  render();
}

function render() {
  els.calendarTitle.textContent = `Calendario de ${monthLabel(state.month)}`;
  renderSummaryCards();
  renderCalendar();
  renderEntries();
}

function renderSummaryCards() {
  const totals = state.entries.reduce(
    (acc, entry) => {
      acc.total += Number(entry.cantidad);
      acc.abonados += entry.abonado ? 1 : 0;
      if (entry.tipo === "horas_extras") acc.extras += Number(entry.cantidad);
      if (entry.tipo === "compensar") acc.compensar += Number(entry.cantidad);
      if (entry.tipo === "dia_vale_extra") acc.diaVale += Number(entry.cantidad);
      return acc;
    },
    { total: 0, extras: 0, compensar: 0, diaVale: 0, abonados: 0 }
  );
  els.totalHoras.textContent = formatHours(totals.total);
  els.totalExtras.textContent = formatHours(totals.extras);
  els.totalCompensar.textContent = formatHours(totals.compensar);
  els.totalDiaVale.textContent = formatHours(totals.diaVale);
  els.totalAbonados.textContent = totals.abonados;
}

function renderCalendar() {
  const [year, monthIndex] = state.month.split("-").map(Number);
  const firstDate = new Date(year, monthIndex - 1, 1);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const startOffset = (firstDate.getDay() + 6) % 7;
  const byDate = new Map(state.summary.map((item) => [item.fecha, item]));

  els.calendarGrid.innerHTML = "";
  for (let i = 0; i < startOffset; i += 1) {
    const empty = document.createElement("div");
    empty.className = "calendar-day empty";
    els.calendarGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${state.month}-${String(day).padStart(2, "0")}`;
    const summary = byDate.get(date);
    const total = Number(summary?.total || 0);
    const level = total >= 6 ? "high" : total >= 3 ? "medium" : total > 0 ? "low" : "";
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `calendar-day ${total ? `has-hours ${level}` : ""}`.trim();
    cell.innerHTML = `
      <span class="day-number">${day}</span>
      <span class="day-total">${total ? formatHours(total) : ""}</span>
      <span class="day-meta">${summary ? `${summary.registros} carga(s)` : ""}</span>
    `;
    cell.addEventListener("click", () => {
      els.fecha.value = date;
      els.cantidad.focus();
    });
    els.calendarGrid.appendChild(cell);
  }
}

function renderEntries() {
  if (!state.entries.length) {
    els.entriesList.innerHTML = `<p class="empty-state">Todavia no hay cargas para este mes.</p>`;
    return;
  }

  els.entriesList.innerHTML = "";
  state.entries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "entry";
    item.innerHTML = `
      <input type="checkbox" ${entry.abonado ? "checked" : ""} aria-label="Marcar abonado">
      <div class="entry-main">
        <strong>${entry.fecha} · ${formatHours(entry.cantidad)} · ${displayType(entry.tipo)}</strong>
        <div class="entry-meta">
          ${entry.wo_cm ? `<span class="pill">WO-CM: ${escapeHtml(entry.wo_cm)}</span>` : ""}
          <span class="pill ${entry.abonado ? "paid" : ""}">${entry.abonado ? "Abonado" : "Pendiente"}</span>
          ${entry.abonado_detalle ? `<span class="pill">${escapeHtml(entry.abonado_detalle)}</span>` : ""}
        </div>
      </div>
      <div class="entry-actions">
        <button type="button" data-action="note">Notas</button>
        <button type="button" data-action="edit">Editar</button>
        <button type="button" data-action="delete" class="delete">Eliminar</button>
      </div>
    `;

    item.querySelector("input").addEventListener("change", async (event) => {
      await api(`/api/registros/${entry.id}`, {
        method: "PUT",
        body: JSON.stringify({ abonado: event.target.checked }),
      });
      await loadMonth();
    });

    item.querySelector('[data-action="note"]').addEventListener("click", () => showNote(entry));
    item.querySelector('[data-action="edit"]').addEventListener("click", () => fillForm(entry));
    item.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm("Eliminar esta carga?")) return;
      await api(`/api/registros/${entry.id}`, { method: "DELETE" });
      await loadMonth();
    });

    els.entriesList.appendChild(item);
  });
}

function fillForm(entry) {
  els.formTitle.textContent = "Editar carga";
  els.entryId.value = entry.id;
  els.fecha.value = entry.fecha;
  els.tipo.value = entry.tipo;
  els.cantidad.value = entry.cantidad;
  els.woCm.value = entry.wo_cm || "";
  els.nota.value = entry.nota || "";
  els.abonado.checked = Boolean(entry.abonado);
  els.abonadoDetalle.value = entry.abonado_detalle || "";
  els.fecha.focus();
}

function resetForm() {
  els.formTitle.textContent = "Nueva carga";
  els.entryForm.reset();
  els.entryId.value = "";
  els.fecha.value = `${state.month}-${String(new Date().getDate()).padStart(2, "0")}`;
  els.formMessage.textContent = "";
}

function showNote(entry) {
  const lines = [
    `Fecha: ${entry.fecha}`,
    `Tipo: ${displayType(entry.tipo)}`,
    `Cantidad: ${formatHours(entry.cantidad)}`,
    entry.wo_cm ? `WO-CM: ${entry.wo_cm}` : "",
    entry.abonado_detalle ? `Abonado en: ${entry.abonado_detalle}` : "",
    "",
    entry.nota || "Sin notas cargadas.",
  ].filter((line, index) => line || index === 5);
  els.noteContent.textContent = lines.join("\n");
  els.noteDialog.showModal();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function shiftMonth(delta) {
  const [year, monthIndex] = state.month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1 + delta, 1);
  state.month = date.toISOString().slice(0, 7);
  loadMonth();
}

els.entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    fecha: els.fecha.value,
    tipo: els.tipo.value,
    cantidad: els.cantidad.value,
    wo_cm: els.woCm.value,
    nota: els.nota.value,
    abonado: els.abonado.checked,
    abonado_detalle: els.abonadoDetalle.value,
  };

  try {
    const id = els.entryId.value;
    if (id) {
      await api(`/api/registros/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      els.formMessage.textContent = "Carga actualizada.";
    } else {
      await api("/api/registros", { method: "POST", body: JSON.stringify(payload) });
      els.formMessage.textContent = "Carga guardada.";
    }
    state.month = payload.fecha.slice(0, 7);
    await loadMonth();
    resetForm();
  } catch (error) {
    els.formMessage.textContent = error.message;
  }
});

els.clearForm.addEventListener("click", resetForm);
els.monthInput.addEventListener("change", () => {
  state.month = els.monthInput.value;
  resetForm();
  loadMonth();
});
els.prevMonth.addEventListener("click", () => shiftMonth(-1));
els.nextMonth.addEventListener("click", () => shiftMonth(1));

els.monthInput.value = state.month;
resetForm();
loadMonth();
