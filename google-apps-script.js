const SPREADSHEET_ID = "1TVUEFeuNlOj-aLMbKJ1kxJDnRt_uuowoac5G_Xoxzm4";
const STATE_KEY = "escala-evr-v1";
const SYNC_TOKEN = "";
const ADMIN_PASSWORD = "EVR 2026";

const SHEETS = {
  meta: "meta",
  people: "people",
  assignments: "assignments",
  fixedAssignments: "fixed_assignments",
  monthlyShifts: "monthly_shifts",
  restrictions: "restrictions",
  holidays: "holidays",
  legacyImports: "legacy_imports",
  history: "history",
  legacyState: "state",
};

const HEADERS = {
  meta: ["key", "value"],
  people: ["id", "name", "base_shift"],
  assignments: ["date", "shift", "person_id", "position"],
  fixedAssignments: ["date", "shift", "person_id", "origin_date", "origin_shift"],
  monthlyShifts: ["month", "person_id", "shift"],
  restrictions: ["id", "person_id", "type", "start", "end", "note", "vacation_period", "vacation_year"],
  holidays: ["id", "date", "name"],
  legacyImports: ["import_key"],
  history: ["version", "updated_at", "source", "people_count", "assignment_rows", "fixed_rows", "restriction_count", "holiday_count"],
};

function doGet(e) {
  const action = e.parameter.action || "load";

  if (action === "ping") {
    return jsonResponse({
      ok: true,
      app: "Escala EVR Sync",
      storage: "normalized-sheets",
      now: new Date().toISOString(),
    });
  }

  if (action === "load") return loadState();
  if (action === "team") return loadTeam();

  return jsonResponse({ ok: false, error: "Ação GET inválida." });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || "{}");
    const action = payload.action || "save";

    if (SYNC_TOKEN && payload.token !== SYNC_TOKEN) {
      return jsonResponse({ ok: false, error: "Token inválido." });
    }

    if (action === "vacation-save" || action === "vacation-delete") return saveTeamVacation(payload);
    if (["restriction-list", "restriction-save", "restriction-delete"].includes(action)) {
      if (payload.password !== ADMIN_PASSWORD) return jsonResponse({ ok: false, error: "Senha administrativa incorreta." });
      return manageRestrictions(payload);
    }
    if (action === "save") {
      if (payload.password !== ADMIN_PASSWORD) return jsonResponse({ ok: false, error: "Senha administrativa incorreta. Atualize o aplicativo." });
      return saveState(payload);
    }

    return jsonResponse({ ok: false, error: "Ação POST inválida." });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: "Erro ao processar requisição.",
      detail: String(error),
    });
  }
}

function loadState() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return loadStateUnlocked(); } finally { lock.releaseLock(); }
}

function loadStateUnlocked() {
  ensureAllSheets();
  const meta = readMeta();
  let state = readNormalizedState();

  if (!hasStateContent(state)) {
    state = readLegacyJsonState();
  }

  return jsonResponse({
    ok: true,
    exists: hasStateContent(state),
    key: STATE_KEY,
    state,
    restrictionStorage: "independent-v1",
    version: Number(meta.version || 0),
    updatedAt: meta.updated_at || null,
  });
}

function saveState(payload) {
  if (!payload.state || typeof payload.state !== "object") {
    return jsonResponse({ ok: false, error: "Estado inválido." });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    ensureAllSheets();
    const meta = readMeta();
    const currentVersion = Number(meta.version || 0);
    const incomingVersion = Number(payload.version || 0);

    const currentRestrictions = readRestrictions();
    const currentHolidays = readHolidays();

    const scheduleVersion = Number(meta.schedule_version || currentVersion);
    if (payload.force !== true && scheduleVersion > incomingVersion) {
      return jsonResponse({
        ok: false,
        conflict: true,
        error: "Existe uma versão mais nova na planilha.",
        currentVersion,
        incomingVersion,
      });
    }

    const nextVersion = Math.max(currentVersion, incomingVersion) + 1;
    const now = new Date().toISOString();
    const summary = writeNormalizedState({ ...payload.state, restrictions: currentRestrictions, holidays: currentHolidays }, { scheduleOnly: true });

    writeMeta({
      state_key: STATE_KEY,
      schema: "normalized-sheets-v1",
      version: String(nextVersion),
      schedule_version: String(nextVersion),
      updated_at: now,
      source: payload.source || "web",
    });

    appendHistory({
      version: nextVersion,
      updatedAt: now,
      source: payload.source || "web",
      summary,
    });

    return jsonResponse({
      ok: true,
      key: STATE_KEY,
      version: nextVersion,
      updatedAt: now,
      storage: "normalized-sheets",
      restrictions: currentRestrictions,
      holidays: currentHolidays,
      restrictionStorage: "independent-v1",
    });
  } finally {
    lock.releaseLock();
  }
}

function restrictionSignature(record) {
  if (!record) return "";
  return JSON.stringify([record.id, record.personId, record.type, record.start, record.end, record.note || "", Number(record.vacationPeriod) || null, Number(record.vacationYear) || null, record.date, record.name]);
}

function isTeamVacation(r) {
  return String(r.type).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === "ferias";
}

function vacationRevision(r) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, restrictionSignature(r)));
}

function teamSnapshot() {
  return {
    ok: true,
    people: readPeople().map((p) => ({ id: p.id, name: p.name })),
    vacations: readRestrictions().filter(isTeamVacation).map((r) => ({
      id: r.id, personId: r.personId, start: r.start, end: r.end,
      vacationPeriod: r.vacationPeriod, vacationYear: r.vacationYear, revision: vacationRevision(r),
    })),
  };
}

function loadTeam() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { ensureAllSheets(); return jsonResponse(teamSnapshot()); }
  finally { lock.releaseLock(); }
}

function adminRestrictionSnapshot() {
  return {
    ...teamSnapshot(),
    restrictions: readRestrictions().map((r) => ({ ...r, revision: vacationRevision(r) })),
    holidays: readHolidays().map((r) => ({ ...r, revision: vacationRevision(r) })),
  };
}

function assertCivilRange(start, end) {
  for (const key of [start, end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(key + "T00:00:00Z")) || new Date(key + "T00:00:00Z").toISOString().slice(0, 10) !== key) throw new Error("Informe datas válidas.");
  }
  if (end < start) throw new Error("O término deve ser igual ou posterior ao início.");
}

function manageRestrictions(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureAllSheets();
    if (payload.action === "restriction-list") return jsonResponse(adminRestrictionSnapshot());
    const holiday = payload.kind === "holiday";
    const records = holiday ? readHolidays() : readRestrictions();
    const existing = records.find((r) => r.id === payload.id);
    if (existing && payload.revision !== vacationRevision(existing)) throw new Error("Este registro mudou em outra tela. Atualize antes de editar novamente.");
    if (!existing && payload.revision) throw new Error("O registro foi removido. Atualize os dados.");
    if (typeof payload.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(payload.id)) throw new Error("Identificador inválido.");
    const next = records.filter((r) => r.id !== payload.id);
    if (payload.action === "restriction-delete") {
      if (!existing) throw new Error("Registro não encontrado.");
    } else {
      const start = String(payload.start || ""), end = holiday ? start : String(payload.end || "");
      assertCivilRange(start, end);
      if (holiday) {
        const name = String(payload.note || "").trim();
        if (!name) throw new Error("Informe o nome do feriado.");
        next.push({ id: payload.id, date: start, name });
      } else {
        if (!readPeople().some((p) => p.id === payload.personId)) throw new Error("Selecione uma pessoa cadastrada.");
        if (!["Férias", "Curso", "Atestado", "Outro impedimento"].includes(payload.type)) throw new Error("Tipo de restrição inválido.");
        const r = { id: payload.id, personId: payload.personId, type: payload.type, start, end, note: String(payload.note || ""), vacationPeriod: null, vacationYear: null };
        if (isTeamVacation(r)) {
          r.vacationPeriod = Number(payload.vacationPeriod); r.vacationYear = Number(payload.vacationYear);
          if (![1, 2, 3].includes(r.vacationPeriod) || !Number.isInteger(r.vacationYear) || r.vacationYear < 2000 || r.vacationYear > 2100) throw new Error("Informe período e competência válidos.");
          try { validateTeamVacation(r, records); }
          catch (error) {
            if (payload.acceptWarnings !== true) return jsonResponse({ ok: false, warning: true, error: error.message });
          }
        }
        next.push(r);
      }
    }
    if (holiday) replaceSheetRows(SHEETS.holidays, HEADERS.holidays, next.map((r) => [r.id, r.date, r.name]));
    else replaceSheetRows(SHEETS.restrictions, HEADERS.restrictions, next.map((r) => [r.id, r.personId, r.type, r.start, r.end, r.note || "", r.vacationPeriod || "", r.vacationYear || ""]));
    const meta = readMeta();
    writeMeta({ ...meta, version: String(Number(meta.version || 0) + 1), updated_at: new Date().toISOString(), source: "restricoes-admin" });
    return jsonResponse(adminRestrictionSnapshot());
  } catch (error) { return jsonResponse({ ok: false, error: error.message }); }
  finally { lock.releaseLock(); }
}

function vacationDays(r) {
  return (Date.parse(r.end + "T00:00:00Z") - Date.parse(r.start + "T00:00:00Z")) / 86400000 + 1;
}

function validateTeamVacation(r, restrictions) {
  for (const key of [r.start, r.end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(Date.parse(key + "T00:00:00Z")) || new Date(key + "T00:00:00Z").toISOString().slice(0, 10) !== key) throw new Error("Informe datas válidas.");
  }
  if (r.end < r.start) throw new Error("O término deve ser igual ou posterior ao início.");
  if (![1, 2, 3].includes(r.vacationPeriod) || !Number.isInteger(r.vacationYear) || r.vacationYear < 2000 || r.vacationYear > 2100) throw new Error("Informe período e competência válidos.");
  if (r.vacationPeriod === 1 && [0, 5, 6].includes(new Date(r.start + "T00:00:00Z").getUTCDay())) throw new Error("O primeiro período deve começar entre segunda e quinta-feira.");
  const own = restrictions.filter((other) => other.personId === r.personId && other.id !== r.id);
  if (own.some((other) => other.start <= r.end && other.end >= r.start)) throw new Error("Estas datas coincidem com férias ou outro impedimento seu já cadastrado.");
  const sameYear = own.filter((other) => isTeamVacation(other) && Number(other.vacationYear) === r.vacationYear);
  if (sameYear.length >= 3 || sameYear.some((other) => Number(other.vacationPeriod) === r.vacationPeriod)) throw new Error("Já existe esse período nesta competência, ou os três períodos já foram cadastrados.");
  const total = sameYear.reduce((sum, other) => sum + vacationDays(other), vacationDays(r));
  if (total > 30) throw new Error("O total desta competência ultrapassa 30 dias.");
  if (sameYear.length === 2 && total !== 30) throw new Error("Com três períodos, o total deve completar 30 dias.");
}

function saveTeamVacation(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureAllSheets();
    if (!readPeople().some((p) => p.id === payload.personId)) throw new Error("Pessoa não encontrada.");
    const restrictions = readRestrictions();
    const existing = restrictions.find((r) => r.id === payload.id);
    if (existing && (existing.personId !== payload.personId || !isTeamVacation(existing))) throw new Error("Este registro não pertence às férias da pessoa selecionada.");
    if (existing && payload.revision !== vacationRevision(existing)) throw new Error("Estas férias foram alteradas em outra tela. Atualize os dados antes de editar novamente.");
    if (!existing && payload.revision) throw new Error("Este registro foi removido. Atualize os dados.");
    let next = restrictions.filter((r) => r.id !== payload.id);
    if (payload.action === "vacation-delete") {
      if (!existing) throw new Error("Registro não encontrado. Atualize os dados.");
    } else {
      if (typeof payload.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(payload.id)) throw new Error("Identificador inválido.");
      const r = { id: payload.id, personId: payload.personId, type: "Férias", start: String(payload.start || ""), end: String(payload.end || ""), vacationPeriod: Number(payload.vacationPeriod), vacationYear: Number(payload.vacationYear), note: existing?.note || "" };
      validateTeamVacation(r, restrictions);
      next.push(r);
    }
    const rows = next.map((r) => [r.id, r.personId, r.type, r.start, r.end, r.note || "", r.vacationPeriod || "", r.vacationYear || ""]);
    replaceSheetRows(SHEETS.restrictions, HEADERS.restrictions, rows);
    const meta = readMeta();
    writeMeta({ ...meta, version: String(Number(meta.version || 0) + 1), updated_at: new Date().toISOString(), source: "equipe:" + payload.personId });
    return jsonResponse(teamSnapshot());
  } catch (error) { return jsonResponse({ ok: false, error: error.message }); }
  finally { lock.releaseLock(); }
}

function readNormalizedState() {
  const state = {
    people: readPeople(),
    assignments: readAssignments(),
    fixedAssignments: readFixedAssignments(),
    monthlyShifts: readMonthlyShifts(),
    restrictions: readRestrictions(),
    holidays: readHolidays(),
    legacyImports: readLegacyImports(),
  };
  return state;
}

function hasStateContent(state) {
  return Boolean(
    (state.people && state.people.length) ||
      (state.assignments && Object.keys(state.assignments).length) ||
      (state.restrictions && state.restrictions.length)
  );
}

function writeNormalizedState(state, options = {}) {
  const normalized = normalizeState(state);
  const peopleRows = normalized.people.map((person) => [person.id, person.name, person.baseShift]);
  const assignmentRows = [];
  Object.keys(normalized.assignments)
    .sort()
    .forEach((date) => {
      ["24x72", "12x36", "Comercial"].forEach((shift) => {
        (normalized.assignments[date][shift] || []).forEach((personId, index) => {
          assignmentRows.push([date, shift, personId, index + 1]);
        });
      });
    });

  const fixedRows = Object.entries(normalized.fixedAssignments).map(([key, value]) => {
    const [date, shift, personId] = key.split("|");
    const fixed = value && typeof value === "object" ? value : {};
    return [date, shift, personId, fixed.originDate || date, fixed.originShift || shift];
  });

  const monthlyRows = [];
  Object.keys(normalized.monthlyShifts)
    .sort()
    .forEach((month) => {
      Object.entries(normalized.monthlyShifts[month] || {})
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .forEach(([personId, shift]) => monthlyRows.push([month, personId, shift]));
    });

  const restrictionRows = normalized.restrictions.map((restriction) => [
    restriction.id,
    restriction.personId,
    restriction.type,
    restriction.start,
    restriction.end,
    restriction.note || "",
    [1, 2, 3].includes(Number(restriction.vacationPeriod)) ? Number(restriction.vacationPeriod) : "",
    /^\d{4}$/.test(String(restriction.vacationYear || "")) ? Number(restriction.vacationYear) : "",
  ]);

  const holidayRows = normalized.holidays.map((holiday) => [holiday.id, holiday.date, holiday.name]);
  const legacyRows = normalized.legacyImports.map((importKey) => [importKey]);

  replaceSheetRows(SHEETS.people, HEADERS.people, peopleRows);
  replaceSheetRows(SHEETS.assignments, HEADERS.assignments, assignmentRows);
  replaceSheetRows(SHEETS.fixedAssignments, HEADERS.fixedAssignments, fixedRows);
  replaceSheetRows(SHEETS.monthlyShifts, HEADERS.monthlyShifts, monthlyRows);
  if (!options.scheduleOnly) {
    replaceSheetRows(SHEETS.restrictions, HEADERS.restrictions, restrictionRows);
    replaceSheetRows(SHEETS.holidays, HEADERS.holidays, holidayRows);
  }
  replaceSheetRows(SHEETS.legacyImports, HEADERS.legacyImports, legacyRows);

  return {
    peopleCount: peopleRows.length,
    assignmentRows: assignmentRows.length,
    fixedRows: fixedRows.length,
    restrictionCount: restrictionRows.length,
    holidayCount: holidayRows.length,
  };
}

function normalizeState(value) {
  const state = {
    people: Array.isArray(value.people) ? value.people : [],
    assignments: value.assignments && typeof value.assignments === "object" ? value.assignments : {},
    fixedAssignments: value.fixedAssignments && typeof value.fixedAssignments === "object" ? value.fixedAssignments : {},
    monthlyShifts: value.monthlyShifts && typeof value.monthlyShifts === "object" ? value.monthlyShifts : {},
    restrictions: Array.isArray(value.restrictions) ? value.restrictions : [],
    holidays: Array.isArray(value.holidays) ? value.holidays : [],
    legacyImports: Array.isArray(value.legacyImports) ? value.legacyImports : [],
  };

  Object.keys(state.assignments).forEach((date) => {
    state.assignments[date] = {
      "24x72": Array.isArray(state.assignments[date]["24x72"]) ? state.assignments[date]["24x72"] : [],
      "12x36": Array.isArray(state.assignments[date]["12x36"]) ? state.assignments[date]["12x36"] : [],
      Comercial: Array.isArray(state.assignments[date].Comercial) ? state.assignments[date].Comercial : [],
    };
  });

  return state;
}

function readPeople() {
  return getRows(SHEETS.people).map((row) => ({
    id: String(row.id || ""),
    name: String(row.name || ""),
    baseShift: String(row.base_shift || "24x72"),
  }));
}

function readAssignments() {
  const assignments = {};
  getRows(SHEETS.assignments)
    .sort((a, b) => formatSheetDate(a.date).localeCompare(formatSheetDate(b.date)) || Number(a.position || 0) - Number(b.position || 0))
    .forEach((row) => {
      const date = formatSheetDate(row.date);
      const shift = String(row.shift || "");
      const personId = String(row.person_id || "");
      if (!date || !["24x72", "12x36", "Comercial"].includes(shift) || !personId) return;
      if (!assignments[date]) assignments[date] = { "24x72": [], "12x36": [], Comercial: [] };
      assignments[date][shift].push(personId);
    });
  return assignments;
}

function readFixedAssignments() {
  const fixedAssignments = {};
  getRows(SHEETS.fixedAssignments).forEach((row) => {
    const date = formatSheetDate(row.date);
    const shift = String(row.shift || "");
    const personId = String(row.person_id || "");
    if (!date || !shift || !personId) return;
    fixedAssignments[`${date}|${shift}|${personId}`] = {
      originDate: formatSheetDate(row.origin_date || date),
      originShift: String(row.origin_shift || shift),
    };
  });
  return fixedAssignments;
}

function readMonthlyShifts() {
  const monthlyShifts = {};
  getRows(SHEETS.monthlyShifts).forEach((row) => {
    const month = formatSheetMonth(row.month);
    const personId = String(row.person_id || "");
    const shift = String(row.shift || "");
    if (!month || !personId || !shift) return;
    if (!monthlyShifts[month]) monthlyShifts[month] = {};
    monthlyShifts[month][personId] = shift;
  });
  return monthlyShifts;
}

function readRestrictions() {
  return getRows(SHEETS.restrictions).map((row) => ({
    id: String(row.id || ""),
    personId: String(row.person_id || ""),
    type: String(row.type || ""),
    start: formatSheetDate(row.start),
    end: formatSheetDate(row.end),
    note: String(row.note || ""),
    vacationPeriod: [1, 2, 3].includes(Number(row.vacation_period)) ? Number(row.vacation_period) : null,
    vacationYear: /^\d{4}$/.test(String(row.vacation_year || "")) ? Number(row.vacation_year) : null,
  }));
}

function readHolidays() {
  return getRows(SHEETS.holidays).map((row) => ({
    id: String(row.id || ""),
    date: formatSheetDate(row.date),
    name: String(row.name || ""),
  }));
}

function readLegacyImports() {
  return getRows(SHEETS.legacyImports)
    .map((row) => String(row.import_key || ""))
    .filter(Boolean);
}

function readLegacyJsonState() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEETS.legacyState);
  if (!sheet) return emptyState();
  const values = sheet.getDataRange().getValues();
  for (let index = 1; index < values.length; index += 1) {
    if (values[index][0] === STATE_KEY && values[index][1]) {
      try {
        return normalizeState(JSON.parse(values[index][1]));
      } catch (error) {
        return emptyState();
      }
    }
  }
  return emptyState();
}

function emptyState() {
  return {
    people: [],
    assignments: {},
    fixedAssignments: {},
    monthlyShifts: {},
    restrictions: [],
    holidays: [],
    legacyImports: [],
  };
}

function ensureAllSheets() {
  ensureSheet(SHEETS.meta, HEADERS.meta);
  ensureSheet(SHEETS.people, HEADERS.people);
  ensureSheet(SHEETS.assignments, HEADERS.assignments);
  ensureSheet(SHEETS.fixedAssignments, HEADERS.fixedAssignments);
  ensureSheet(SHEETS.monthlyShifts, HEADERS.monthlyShifts);
  ensureSheet(SHEETS.restrictions, HEADERS.restrictions);
  ensureSheet(SHEETS.holidays, HEADERS.holidays);
  ensureSheet(SHEETS.legacyImports, HEADERS.legacyImports);
  ensureSheet(SHEETS.history, HEADERS.history);
}

function ensureSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = currentHeaders.every((value) => !value);
  if (needsHeader) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function replaceSheetRows(name, headers, rows) {
  const sheet = ensureSheet(name, headers);
  if (sheet.getMaxRows() < rows.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  const maxRows = sheet.getMaxRows();
  const maxColumns = Math.max(sheet.getMaxColumns(), headers.length);
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, maxColumns).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    const range = sheet.getRange(2, 1, rows.length, headers.length);
    // Datas da escala são valores civis; texto puro impede conversões de fuso do Sheets.
    range.setNumberFormat("@");
    range.setValues(rows.map((row) => row.map((value) => String(value ?? ""))));
  }
}

function getRows(name) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const headers = values[0].map((header) => String(header || ""));
  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      if (header) item[header] = row[index];
    });
    return item;
  });
}

function readMeta() {
  const meta = {};
  getRows(SHEETS.meta).forEach((row) => {
    if (row.key) meta[String(row.key)] = row.value instanceof Date ? row.value.toISOString() : row.value;
  });
  return meta;
}

function writeMeta(values) {
  const rows = Object.entries(values).map(([key, value]) => [key, value]);
  replaceSheetRows(SHEETS.meta, HEADERS.meta, rows);
}

function appendHistory(entry) {
  const sheet = ensureSheet(SHEETS.history, HEADERS.history);
  sheet.appendRow([
    entry.version,
    entry.updatedAt,
    entry.source,
    entry.summary.peopleCount,
    entry.summary.assignmentRows,
    entry.summary.fixedRows,
    entry.summary.restrictionCount,
    entry.summary.holidayCount,
  ]);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function formatSheetDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone(), "yyyy-MM-dd");
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone(), "yyyy-MM-dd");
  }
  return text;
}

function formatSheetMonth(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone(), "yyyy-MM");
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone(), "yyyy-MM");
  }
  return text;
}
