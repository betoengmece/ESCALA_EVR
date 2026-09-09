const ENDPOINT = "https://script.google.com/macros/s/AKfycbwBO_8h__5F1PpugzjocJn9DSzOJD50K7EQ3OSRf6zYoKscaFzRV-itFSS9lQhEw3w5mg/exec";
const $ = (id) => document.getElementById(id);
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
}
async function request(payload) {
  const response = await fetch(payload ? ENDPOINT : `${ENDPOINT}?action=team&t=${Date.now()}`, payload ? {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload),
  } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível acessar a nuvem.");
  if (!Array.isArray(result.people) || !Array.isArray(result.vacations)) throw new Error("O acesso da equipe ainda não foi ativado na nuvem. Avise o administrador.");
  return result;
}
function resetForm() {
  editing = null; draftId = crypto.randomUUID(); dirty = false;
  $("vacation-form").reset(); $("cancel").hidden = true; $("form-title").textContent = "Novo período";
  const used = new Set(ownYear().map((r) => Number(r.vacationPeriod)));
  $("period").value = [1, 2, 3].find((n) => !used.has(n)) || 1;
  preview();
}
function ownYear() {
  return data.vacations.filter((r) => r.personId === personId && Number(r.vacationYear) === Number($("year").value));
}
function render() {
  $("people").innerHTML = data.people.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((p) =>
    `<button class="person" data-person="${escapeText(p.id)}"><span class="initials" aria-hidden="true">${escapeText(p.name.slice(0, 2))}</span><span>${escapeText(p.name)}</span></button>`,
  ).join("") || '<p class="empty">Equipe ainda não cadastrada.</p>';
  $("selection").hidden = !!personId; $("workspace").hidden = !personId;
  if (!personId) return;
  $("person-name").textContent = data.people.find((p) => p.id === personId)?.name || "Pessoa removida";
  const own = ownYear().sort((a, b) => a.start.localeCompare(b.start));
  const total = own.reduce((sum, r) => sum + days(r), 0);
  const unknown = data.vacations.filter((r) => r.personId === personId && !r.vacationYear);
  $("balance").textContent = `${total}/30 dias · ${own.length}/3 períodos${total < 30 ? ` · Restam ${30 - total} dias` : ""}`;
  $("vacations").innerHTML = [...own, ...unknown].map((r) => `<article class="vacation"><strong>${r.vacationPeriod ? `${r.vacationPeriod}º período` : "Período não informado"}${!r.vacationYear ? " · competência pendente" : ""}</strong><p>${label(r.start)} a ${label(r.end)} · ${days(r)} dias</p><div class="actions"><button data-edit="${escapeText(r.id)}">Editar</button><button class="delete" data-delete="${escapeText(r.id)}">Excluir</button></div></article>`).join("") || '<p class="empty">Nenhum período nesta competência.</p>';
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
    const countLabel = ids.length === 0 ? "Ninguém escolheu essa data" : `${ids.length} já ${ids.length === 1 ? "escolheu" : "escolheram"} essa data`;
    return `<div class="day ${[0, 6].includes(date.getDay()) ? "weekend" : ""}"><b>${i + 1} ${date.toLocaleDateString("pt-BR", { weekday: "short" })}</b><div class="names">${ids.map((id) => `<span class="tag ${id === personId ? "mine" : ""}">${escapeText(names.get(id) || "Pessoa removida")}</span>`).join("") || '<span class="empty">—</span>'}</div><span class="count ${ids.length > 1 ? "busy" : ""}">${countLabel}</span></div>`;
  }).join("");
}
function draft() {
  return { action: "vacation-save", personId, id: editing?.id || draftId, revision: editing?.revision || "", start: $("start").value, end: $("end").value, vacationPeriod: Number($("period").value), vacationYear: Number($("year").value) };
}
function preview() {
  const r = draft(); const total = days(r);
  let warning = "";
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
  try { data = await request(); resetForm(); render(); status("Dados atualizados.", "success"); }
  catch (error) { status(error.message, "error"); }
  finally { setBusy(false); }
}
async function save(payload) {
  setBusy(true); status("Salvando...");
  try { data = await request(payload); resetForm(); render(); status(payload.action === "vacation-delete" ? "Período excluído." : "Férias salvas na nuvem.", "success"); }
  catch (error) { status(`${error.message} Sua edição foi mantida.`, "error"); }
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
$("month").onchange = renderCalendar;
$("year").onchange = () => { if (editing || $("start").value || $("end").value) dirty = true; render(); preview(); };
$("vacation-form").oninput = () => { dirty = true; preview(); };
$("vacation-form").onsubmit = (event) => { event.preventDefault(); if (!busy) save(draft()); };
$("vacations").onclick = (event) => {
  if (busy) return;
  const button = event.target.closest("[data-edit],[data-delete]");
  if (!button) return;
  const record = data.vacations.find((r) => r.id === (button.dataset.edit || button.dataset.delete) && r.personId === personId);
  if (!record) return;
  if (button.dataset.delete) { if (confirm(`Excluir as férias de ${label(record.start)} a ${label(record.end)}?`)) save({ action: "vacation-delete", personId, id: record.id, revision: record.revision }); return; }
  if (dirty && !confirm("Descartar a edição atual?")) return;
  editing = structuredClone(record); $("start").value = record.start; $("end").value = record.end; $("period").value = record.vacationPeriod || 1;
  $("year").value = record.vacationYear || $("year").value;
  $("cancel").hidden = false; $("form-title").textContent = "Editar período"; dirty = false; preview(); $("start").focus();
};
window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
refresh();
