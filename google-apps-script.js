const SPREADSHEET_ID = "1TVUEFeuNlOj-aLMbKJ1kxJDnRt_uuowoac5G_Xoxzm4";
const STATE_KEY = "escala-evr-v1";
const SYNC_TOKEN = "";

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
  restrictions: ["id", "person_id", "type", "start", "end", "note"],
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

  return jsonResponse({ ok: false, error: "Ação GET inválida." });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || "{}");
    const action = payload.action || "save";

    if (SYNC_TOKEN && payload.token !== SYNC_TOKEN) {
      return jsonResponse({ ok: false, error: "Token inválido." });
    }

    if (action === "save") return saveState(payload);

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

    if (payload.force !== true && currentVersion > incomingVersion) {
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
    const summary = writeNormalizedState(payload.state);

    writeMeta({
      state_key: STATE_KEY,
      schema: "normalized-sheets-v1",
      version: String(nextVersion),
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
    });
  } finally {
    lock.releaseLock();
  }
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

function writeNormalizedState(state) {
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
  ]);

  const holidayRows = normalized.holidays.map((holiday) => [holiday.id, holiday.date, holiday.name]);
  const legacyRows = normalized.legacyImports.map((importKey) => [importKey]);

  replaceSheetRows(SHEETS.people, HEADERS.people, peopleRows);
  replaceSheetRows(SHEETS.assignments, HEADERS.assignments, assignmentRows);
  replaceSheetRows(SHEETS.fixedAssignments, HEADERS.fixedAssignments, fixedRows);
  replaceSheetRows(SHEETS.monthlyShifts, HEADERS.monthlyShifts, monthlyRows);
  replaceSheetRows(SHEETS.restrictions, HEADERS.restrictions, restrictionRows);
  replaceSheetRows(SHEETS.holidays, HEADERS.holidays, holidayRows);
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
  const maxRows = sheet.getMaxRows();
  const maxColumns = Math.max(sheet.getMaxColumns(), headers.length);
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, maxColumns).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
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
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return text;
}

function formatSheetMonth(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM");
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM");
  }
  return text;
}
