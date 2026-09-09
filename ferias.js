const ENDPOINT = "https://script.google.com/macros/s/AKfycbwBO_8h__5F1PpugzjocJn9DSzOJD50K7EQ3OSRf6zYoKscaFzRV-itFSS9lQhEw3w5mg/exec";
const $ = (id) => document.getElementById(id);
const admin = new URLSearchParams(location.search).get("admin") === "1";
let password = "";
let data = { people: [], vacations: [] };
let personId = null;
let editing = null;
let draftId = crypto.randomUUID();
let busy = false;
let dirty = false;
const today = new Date();
$("year").value = today.getFullYear();
$("month").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const days = (r) => (Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86400000 + 1;
const label = (key) => key.split("-").reverse().join("/");
function status(text, tone = "") { $("status").textContent = text; $("status").className = tone; }
function setBusy(value) {
  busy = value;
  document.querySelectorAll("button, input, select").forEach((el) => { el.disabled = value; });
  if (!value) configureForm();
}
async function request(payload) {
  if (admin) payload = { ...(payload || { action: "restriction-list" }), password };
  const response = await fetch(payload ? ENDPOINT : `${ENDPOINT}?action=team&t=${Date.now()}`, payload ? {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload),
  } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.ok) { const error = new Error(result.error || "Não foi possível acessar a nuvem."); error.warning = result.warning; throw error; }
  if (!Array.isArray(result.people) || !Array.isArray(result.vacations)) throw new Error("O acesso da equipe ainda não foi ativado na nuvem. Avise o administrador.");
  if (admin && (!Array.isArray(result.restrictions) || !Array.isArray(result.holidays))) throw new Error("Atualize a implantação do Apps Script para administrar restrições.");
  return result;
}
function resetForm() {
  editing = null; draftId = crypto.randomUUID(); dirty = false;
  $("vacation-form").reset(); $("cancel").hidden = true; $("form-title").textContent = admin ? "Nova restrição" : "Novo período";
  if (admin && personId !== "all") $("person").value = personId || "";
  const used = new Set(ownYear().map((r) => Number(r.vacationPeriod)));
  $("period").value = [1, 2, 3].find((n) => !used.has(n)) || 1;
  preview();
  configureForm();
}
function configureForm() {
  const holiday = admin && $("type").value === "Feriado";
  $("type-field").hidden = !admin;
  $("person-field").hidden = !admin || holiday;
  $("note-field").hidden = !admin;
  $("note-label").textContent = holiday ? "Nome do feriado" : "Observação";
  $("note").required = holiday;
  $("period-field").hidden = admin && $("type").value !== "Férias";
  $("end").required = !holiday;
  $("end").parentElement.hidden = holiday;
  $("save").textContent = admin ? "Salvar restrição" : "Salvar minhas férias";
  for (const option of $("type").options) option.disabled = !!editing && ((option.value === "Feriado") !== (editing.kind === "holiday"));
}
function allRecords() {
  if (!admin) return data.vacations;
  return [...(data.restrictions || []).map((r) => ({ ...r, kind: "restriction" })), ...(data.holidays || []).map((r) => ({ ...r, kind: "holiday", type: "Feriado", start: r.date, end: r.date, note: r.name }))];
}
function ownYear() {
  return data.vacations.filter((r) => r.personId === personId && Number(r.vacationYear) === Number($("year").value));
}
function render() {
  $("people").innerHTML = data.people.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((p) =>
    `<button class="person" data-person="${escapeText(p.id)}"><span class="initials" aria-hidden="true">${escapeText(p.name.slice(0, 2))}</span><span>${escapeText(p.name)}</span></button>`,
  ).join("") || '<p class="empty">Equipe ainda não cadastrada.</p>';
  if (admin) {
    $("people").insertAdjacentHTML("afterbegin", '<button class="person" data-person="all">Todas as pessoas</button>');
    const selected = $("person").value;
    $("person").innerHTML = '<option value="">Selecione</option>' + data.people.map((p) => `<option value="${escapeText(p.id)}">${escapeText(p.name)}</option>`).join("");
    $("person").value = selected || (personId !== "all" ? personId : "");
    $("admin-filters").hidden = false;
    $("list-title").textContent = "Restrições";
    $("calendar-title").textContent = "Calendário de restrições";
  }
  $("selection").hidden = !!personId; $("workspace").hidden = !personId;
  if (!personId) return;
  $("person-name").textContent = personId === "all" ? "Todas as pessoas" : data.people.find((p) => p.id === personId)?.name || "Pessoa removida";
  const own = ownYear().sort((a, b) => a.start.localeCompare(b.start));
  const total = own.reduce((sum, r) => sum + days(r), 0);
  const unknown = data.vacations.filter((r) => r.personId === personId && !r.vacationYear);
  $("balance").textContent = `${total}/30 dias · ${own.length}/3 períodos${total < 30 ? ` · Restam ${30 - total} dias` : ""}`;
  $("balance").hidden = personId === "all";
  $("vacations").innerHTML = [...own, ...unknown].map((r) => `<article class="vacation"><strong>${r.vacationPeriod ? `${r.vacationPeriod}º período` : "Período não informado"}${!r.vacationYear ? " · competência pendente" : ""}</strong><p>${label(r.start)} a ${label(r.end)} · ${days(r)} dias</p><div class="actions"><button data-edit="${escapeText(r.id)}">Editar</button><button class="delete" data-delete="${escapeText(r.id)}">Excluir</button></div></article>`).join("") || '<p class="empty">Nenhum período nesta competência.</p>';
  if (admin) {
    const now = new Date(); const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const month = $("month").value;
    const filtered = allRecords().filter((r) => (personId === "all" || r.personId === personId || r.kind === "holiday") && ($("filter-type").value === "all" || r.type === $("filter-type").value) && ($("scope").value === "all" || ($("scope").value === "active" ? r.end >= key : r.start <= month + "-31" && r.end >= month + "-01"))).sort((a, b) => a.start.localeCompare(b.start));
    $("vacations").innerHTML = filtered.map((r) => `<article class="vacation"><strong>${escapeText(data.people.find((p) => p.id === r.personId)?.name || "Equipe")} · ${escapeText(r.type)}</strong><p>${label(r.start)} a ${label(r.end)}${r.type === "Férias" ? ` · ${r.vacationPeriod || "?"}º período · competência ${r.vacationYear || "pendente"}` : ""}</p><p>${escapeText(r.note)}</p><div class="actions"><button data-edit="${escapeText(r.id)}">Editar</button><button class="delete" data-delete="${escapeText(r.id)}">Excluir</button></div></article>`).join("") || '<p class="empty">Nenhuma restrição neste filtro.</p>';
  }
  configureForm();
  renderCalendar();
}
function renderCalendar() {
  const month = $("month").value;
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const [year, m] = month.split("-").map(Number);
  const names = new Map(data.people.map((p) => [p.id, p.name]));
  $("calendar").innerHTML = Array.from({ length: new Date(year, m, 0).getDate() }, (_, i) => {
    const key = `${month}-${String(i + 1).padStart(2, "0")}`;
    const date = new Date(`${key}T12:00:00`);
    const ids = [...new Set(data.vacations.filter((r) => r.start <= key && r.end >= key).map((r) => r.personId))];
    if (admin) {
      const records = allRecords().filter((r) => r.start <= key && r.end >= key);
      return `<div class="day ${[0, 6].includes(date.getDay()) ? "weekend" : ""}"><b>${i + 1} ${date.toLocaleDateString("pt-BR", { weekday: "short" })}</b><div class="names">${records.map((r) => `<span class="tag">${escapeText(names.get(r.personId) || "Equipe")}: ${escapeText(r.type)}</span>`).join("") || "—"}</div><span class="count">${records.length} ${records.length === 1 ? "restrição" : "restrições"}</span></div>`;
    }
    const countLabel = ids.length === 0 ? "Ninguém escolheu essa data" : `${ids.length} já ${ids.length === 1 ? "escolheu" : "escolheram"} essa data`;
    return `<div class="day ${[0, 6].includes(date.getDay()) ? "weekend" : ""}"><b>${i + 1} ${date.toLocaleDateString("pt-BR", { weekday: "short" })}</b><div class="names">${ids.map((id) => `<span class="tag ${id === personId ? "mine" : ""}">${escapeText(names.get(id) || "Pessoa removida")}</span>`).join("") || '<span class="empty">—</span>'}</div><span class="count ${ids.length > 1 ? "busy" : ""}">${countLabel}</span></div>`;
  }).join("");
}
function draft() {
  return { action: admin ? "restriction-save" : "vacation-save", personId: admin ? $("person").value : personId, kind: $("type").value === "Feriado" ? "holiday" : "restriction", type: admin ? $("type").value : "Férias", note: $("note").value, id: editing?.id || draftId, revision: editing?.revision || "", start: $("start").value, end: $("end").value, vacationPeriod: Number($("period").value), vacationYear: Number($("year").value) };
}
function preview() {
  const r = draft(); const total = days(r);
  let warning = "";
  if (admin && r.type !== "Férias") { $("preview").textContent = ""; $("preview").className = ""; return; }
  if (r.start && r.end) {
    if (total <= 0) warning = "O término deve ser igual ou posterior ao início.";
    else if (ownYear().filter((v) => v.id !== r.id).reduce((sum, v) => sum + days(v), total) > 30) warning = "O total ultrapassa 30 dias nesta competência.";
    else if (r.vacationPeriod === 1 && [0, 5, 6].includes(new Date(`${r.start}T00:00:00Z`).getUTCDay())) warning = "O primeiro período deve começar entre segunda e quinta-feira.";
  }
  $("preview").textContent = warning || (total > 0 ? `${total} dias corridos` : "");
  $("preview").className = warning ? "error" : "";
}
async function refresh() {
  if (busy || (dirty && !confirm("Descartar a edição e atualizar os dados?"))) return;
  setBusy(true); status("Atualizando...");
  try { data = await request(); $("admin-login").hidden = true; resetForm(); render(); status("Dados atualizados.", "success"); }
  catch (error) { status(error.message, "error"); }
  finally { setBusy(false); }
}
async function save(payload) {
  setBusy(true); status("Salvando...");
  try { data = await request(payload); resetForm(); render(); status(payload.action.endsWith("-delete") ? "Período excluído." : admin ? "Restrição salva na nuvem." : "Férias salvas na nuvem.", "success"); }
  catch (error) {
    if (admin && error.warning && confirm(`${error.message}\n\nSalvar mesmo assim como administrador?`)) { await save({ ...payload, acceptWarnings: true }); return; }
    status(`${error.message} Sua edição foi mantida.`, "error");
  }
  finally { setBusy(false); }
}
$("people").addEventListener("click", (event) => {
  const button = event.target.closest("[data-person]");
  if (!button || busy) return;
  personId = button.dataset.person; resetForm(); render();
});
$("change-person").onclick = () => { if (!dirty || confirm("Descartar a edição?")) { personId = null; resetForm(); render(); } };
$("refresh").onclick = refresh;
$("cancel").onclick = resetForm;
$("month").onchange = () => admin ? render() : renderCalendar();
$("scope").onchange = render;
$("filter-type").onchange = render;
$("type").onchange = () => { configureForm(); preview(); };
$("year").onchange = () => { if (editing || $("start").value || $("end").value) dirty = true; render(); preview(); };
$("vacation-form").oninput = () => { dirty = true; preview(); };
$("vacation-form").onsubmit = (event) => { event.preventDefault(); if (!busy) save(draft()); };
$("vacations").onclick = (event) => {
  if (busy) return;
  const button = event.target.closest("[data-edit],[data-delete]");
  if (!button) return;
  const record = allRecords().find((r) => r.id === (button.dataset.edit || button.dataset.delete) && (admin || r.personId === personId));
  if (!record) return;
  if (button.dataset.delete) { if (confirm(`Excluir ${admin ? "a restrição" : "as férias"} de ${label(record.start)} a ${label(record.end)}?`)) save({ action: admin ? "restriction-delete" : "vacation-delete", personId, kind: record.kind, id: record.id, revision: record.revision }); return; }
  if (dirty && !confirm("Descartar a edição atual?")) return;
  editing = structuredClone(record); $("start").value = record.start; $("end").value = record.end; $("period").value = record.vacationPeriod || 1;
  $("year").value = record.vacationYear || $("year").value;
  if (admin) { $("type").value = record.type; $("person").value = record.personId || ""; $("note").value = record.note || ""; configureForm(); }
  $("cancel").hidden = false; $("form-title").textContent = "Editar período"; dirty = false; preview(); $("start").focus();
};
window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
if (admin) {
  document.title = "Restrições · Escala EVR";
  $("page-label").textContent = "Administração de restrições";
  $("selection").hidden = true; $("admin-login").hidden = false;
  status("Acesso administrativo");
  $("admin-login").onsubmit = (event) => { event.preventDefault(); password = $("admin-password").value; refresh(); };
} else refresh();
