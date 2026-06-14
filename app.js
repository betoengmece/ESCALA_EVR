const STORAGE_KEY = "escala-evr-v1";
const UNDO_STORAGE_KEY = "escala-evr-undo-v1";
const SYNC_META_KEY = "escala-evr-sync-meta-v1";
const SYNC_ENDPOINT = "https://script.google.com/macros/s/AKfycbwBO_8h__5F1PpugzjocJn9DSzOJD50K7EQ3OSRf6zYoKscaFzRV-itFSS9lQhEw3w5mg/exec";
const UNDO_LIMIT = 100;
const UNDO_MAX_BYTES = 1800000;
const SHIFT_HOURS = {
  "24x72": 24,
  "12x36": 12,
  Comercial: 8,
  "Comercial Fixo": 8,
};
const REST_HOURS = {
  "24x72": 96,
  "12x36": 48,
  Comercial: 24,
  "Comercial Fixo": 24,
};
const SHIFT_TYPES = ["24x72", "12x36", "Comercial"];
const PERSON_SHIFT_TYPES = ["24x72", "12x36", "Comercial", "Comercial Fixo"];
const RESTRICTION_TYPES = ["Férias", "Curso", "Atestado", "Outro impedimento"];
const EMPTY_SLOT_ID = "vazio";
const LEGACY_CSV_IMPORT_KEY = "csv-escala-2025-08-v1";

const defaultState = {
  people: [
    { id: "p1", name: "Ana Paula", baseShift: "24x72" },
    { id: "p2", name: "Bruno Lima", baseShift: "24x72" },
    { id: "p3", name: "Carla Souza", baseShift: "12x36" },
    { id: "p4", name: "Diego Alves", baseShift: "12x36" },
    { id: "p5", name: "Elisa Rocha", baseShift: "Comercial" },
    { id: "p6", name: "Felipe Nunes", baseShift: "Comercial" },
    { id: "p7", name: "Douglas Pereira", baseShift: "24x72" },
    { id: "p8", name: "Gabriel Santos", baseShift: "24x72" },
  ],
  assignments: {},
  fixedAssignments: {},
  monthlyShifts: {},
  restrictions: [],
  holidays: [],
  legacyImports: [],
};

let state = loadState();
let undoStack = loadUndoStack();
let syncMeta = loadSyncMeta();
let currentDate = new Date();
currentDate.setDate(1);
let draggedPersonId = null;
let draggedSourceDate = null;
let draggedSourceShift = null;
let reviewMode = true;
let editingRestrictionId = null;
let restrictionFilterValue = "all";

const els = {
  tabs: document.querySelectorAll(".tab-button"),
  pages: document.querySelectorAll(".tab-page"),
  calendarGrid: document.getElementById("calendar-grid"),
  monthTitle: document.getElementById("month-title"),
  monthPicker: document.getElementById("month-picker"),
  prevMonth: document.getElementById("prev-month"),
  nextMonth: document.getElementById("next-month"),
  availableList: document.getElementById("available-list"),
  availableCount: document.getElementById("available-count"),
  autoFill: document.getElementById("auto-fill"),
  optimizeComplete: document.getElementById("optimize-complete"),
  undoAction: document.getElementById("undo-action"),
  exportData: document.getElementById("export-data"),
  exportCsv: document.getElementById("export-csv"),
  importData: document.getElementById("import-data"),
  syncStatus: document.getElementById("sync-status"),
  syncPull: document.getElementById("sync-pull"),
  syncPush: document.getElementById("sync-push"),
  restoreLegacy: document.getElementById("restore-legacy"),
  importFile: document.getElementById("import-file"),
  checkScale: document.getElementById("check-scale"),
  clearMonth: document.getElementById("clear-month"),
  statsGrid: document.getElementById("stats-grid"),
  statsRanking: document.getElementById("stats-ranking"),
  personForm: document.getElementById("person-form"),
  personName: document.getElementById("person-name"),
  personShift: document.getElementById("person-shift"),
  peopleList: document.getElementById("people-list"),
  restrictionForm: document.getElementById("restriction-form"),
  restrictionPerson: document.getElementById("restriction-person"),
  restrictionType: document.getElementById("restriction-type"),
  restrictionStart: document.getElementById("restriction-start"),
  restrictionEnd: document.getElementById("restriction-end"),
  restrictionNote: document.getElementById("restriction-note"),
  restrictionFilter: document.getElementById("restriction-filter"),
  restrictionList: document.getElementById("restriction-list"),
  holidayForm: document.getElementById("holiday-form"),
  holidayDate: document.getElementById("holiday-date"),
  holidayName: document.getElementById("holiday-name"),
  holidayList: document.getElementById("holiday-list"),
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const initialState = window.INITIAL_ESCALA_STATE || defaultState;
  const loaded = saved ? JSON.parse(saved) : structuredClone(initialState);
  loaded.people ||= [];
  const isInitialDemoTeam =
    loaded.people.length === 6 && ["p1", "p2", "p3", "p4", "p5", "p6"].every((id) => loaded.people.some((person) => person.id === id));
  if (isInitialDemoTeam) {
    loaded.people.push(
      { id: "p7", name: "Douglas Pereira", baseShift: "24x72" },
      { id: "p8", name: "Gabriel Santos", baseShift: "24x72" },
    );
  }
  loaded.assignments ||= {};
  loaded.fixedAssignments ||= {};
  loaded.monthlyShifts ||= {};
  loaded.restrictions ||= [];
  loaded.holidays ||= [];
  loaded.legacyImports ||= [];
  Object.keys(loaded.assignments).forEach((key) => {
    loaded.assignments[key] = normalizeAssignments(loaded.assignments[key]);
  });
  return loaded;
}

function loadUndoStack() {
  try {
    const saved = JSON.parse(localStorage.getItem(UNDO_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((item) => typeof item === "string").slice(-UNDO_LIMIT) : [];
  } catch (error) {
    return [];
  }
}

function loadSyncMeta() {
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_META_KEY) || "{}");
    return {
      version: Number(saved.version || 0),
      updatedAt: saved.updatedAt || null,
      lastSyncedAt: saved.lastSyncedAt || null,
      dirty: Boolean(saved.dirty),
    };
  } catch (error) {
    return { version: 0, updatedAt: null, lastSyncedAt: null, dirty: false };
  }
}

function persistSyncMeta() {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
  updateSyncStatus();
}

function markSyncDirty() {
  syncMeta.dirty = true;
  persistSyncMeta();
}

function persistUndoStack() {
  while (undoStack.length > UNDO_LIMIT) undoStack.shift();
  while (undoStack.length && JSON.stringify(undoStack).length > UNDO_MAX_BYTES) undoStack.shift();
  while (undoStack.length) {
    try {
      localStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(undoStack));
      return;
    } catch (error) {
      undoStack.shift();
    }
  }
  localStorage.removeItem(UNDO_STORAGE_KEY);
}

function updateUndoButton() {
  if (!els?.undoAction) return;
  els.undoAction.disabled = undoStack.length === 0;
  els.undoAction.textContent = undoStack.length ? `Desfazer (${undoStack.length})` : "Desfazer";
}

function pushUndoSnapshot(previousRawState) {
  if (!previousRawState) return;
  if (undoStack[undoStack.length - 1] === previousRawState) return;
  undoStack.push(previousRawState);
}

function removeInternalStorageBackups(aggressive = false) {
  const removableKeys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key.startsWith(`${STORAGE_KEY}-before-restore-`) || (aggressive && key.startsWith(`${STORAGE_KEY}-before-`))) {
      removableKeys.push(key);
    }
  }
  removableKeys.forEach((key) => localStorage.removeItem(key));
}

function writePrimaryState(nextRawState) {
  try {
    localStorage.setItem(STORAGE_KEY, nextRawState);
    return true;
  } catch (error) {
    undoStack = [];
    localStorage.removeItem(UNDO_STORAGE_KEY);
    removeInternalStorageBackups(false);
  }

  try {
    localStorage.setItem(STORAGE_KEY, nextRawState);
    return true;
  } catch (error) {
    removeInternalStorageBackups(true);
  }

  try {
    localStorage.setItem(STORAGE_KEY, nextRawState);
    return true;
  } catch (error) {
    alert("O navegador está sem espaço para salvar a escala. Exporte um backup e limpe dados antigos do site no Chrome.");
    return false;
  }
}

function saveState(options = {}) {
  const nextRawState = JSON.stringify(state);
  const previousRawState = localStorage.getItem(STORAGE_KEY);
  const shouldKeepUndo = !options.skipUndo && previousRawState && previousRawState !== nextRawState;
  if (shouldKeepUndo) pushUndoSnapshot(previousRawState);
  const saved = writePrimaryState(nextRawState);
  if (saved && shouldKeepUndo) persistUndoStack();
  if (saved && !options.skipSyncDirty && previousRawState !== nextRawState) markSyncDirty();
  updateUndoButton();
  return saved;
}

function undoLastChange() {
  const previousRawState = undoStack.pop();
  if (!previousRawState) return;
  try {
    state = normalizeLoadedState(JSON.parse(previousRawState));
    persistUndoStack();
    saveState({ skipUndo: true });
    renderAll();
  } catch (error) {
    persistUndoStack();
    updateUndoButton();
    alert("Não consegui desfazer este movimento.");
  }
}

function normalizeLoadedState(value) {
  const loaded = {
    people: Array.isArray(value?.people) ? value.people : [],
    assignments: value?.assignments && typeof value.assignments === "object" ? value.assignments : {},
    fixedAssignments: value?.fixedAssignments && typeof value.fixedAssignments === "object" ? value.fixedAssignments : {},
    monthlyShifts: value?.monthlyShifts && typeof value.monthlyShifts === "object" ? value.monthlyShifts : {},
    restrictions: Array.isArray(value?.restrictions) ? value.restrictions : [],
    holidays: Array.isArray(value?.holidays) ? value.holidays : [],
    legacyImports: Array.isArray(value?.legacyImports) ? value.legacyImports : [],
  };
  Object.keys(loaded.assignments).forEach((key) => {
    loaded.assignments[key] = normalizeAssignments(loaded.assignments[key]);
  });
  return loaded;
}

function normalizeLegacyText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function legacySlug(value) {
  return normalizeLegacyText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const legacyPersonAliases = {
  BRUNO: "BRUNO LIMA",
  DOUGLAS: "DOUGLAS PEREIRA",
  GABRIEL: "GABRIEL SANTOS",
};

function findLegacyPersonByName(name) {
  const normalized = normalizeLegacyText(name);
  const alias = legacyPersonAliases[normalized];
  return state.people.find((person) => {
    const personName = normalizeLegacyText(person.name);
    return personName === normalized || (alias && personName === alias);
  });
}

function ensureLegacyPerson(legacyPerson) {
  const existing = findLegacyPersonByName(legacyPerson.name);
  if (existing) return existing.id;

  let id = `legacy-${legacySlug(legacyPerson.name) || Date.now()}`;
  let suffix = 2;
  while (state.people.some((person) => person.id === id)) {
    id = `legacy-${legacySlug(legacyPerson.name)}-${suffix}`;
    suffix += 1;
  }

  const person = {
    id,
    name: normalizeLegacyText(legacyPerson.name),
    baseShift: PERSON_SHIFT_TYPES.includes(legacyPerson.baseShift) ? legacyPerson.baseShift : "24x72",
  };
  state.people.push(person);
  return person.id;
}

function clearFixedAssignmentsForDate(key) {
  Object.keys(state.fixedAssignments || {}).forEach((fixedAssignmentKey) => {
    if (fixedAssignmentKey.startsWith(`${key}|`)) delete state.fixedAssignments[fixedAssignmentKey];
  });
}

function uniqueLegacyPeople(ids) {
  return [...new Set(ids.filter((id) => id && findPerson(id)))];
}

function addLegacyRestriction(restriction, personId, index, importKey) {
  const alreadyExists = state.restrictions.some((item) => {
    return (
      item.personId === personId &&
      item.type === restriction.type &&
      item.start === restriction.start &&
      item.end === restriction.end &&
      (item.note || "") === (restriction.note || "")
    );
  });
  if (alreadyExists) return;

  state.restrictions.push({
    id: `legacy-${importKey}-${index}`.replace(/[^a-z0-9-]/gi, "-"),
    personId,
    type: restriction.type,
    start: restriction.start,
    end: restriction.end,
    note: restriction.note || "",
  });
}

function removeDemoOnlyPeopleBeforeLegacyImport(legacyPeople) {
  const hasOnlyDemoPeople =
    state.people.length === defaultState.people.length &&
    defaultState.people.every((demoPerson) => state.people.some((person) => person.id === demoPerson.id && person.name === demoPerson.name)) &&
    Object.keys(state.assignments || {}).length === 0 &&
    Object.keys(state.monthlyShifts || {}).length === 0 &&
    (state.restrictions || []).length === 0;

  if (!hasOnlyDemoPeople) return;

  const legacyNames = new Set(legacyPeople.map((person) => normalizeLegacyText(person.name)));
  Object.values(legacyPersonAliases).forEach((alias) => legacyNames.add(alias));
  state.people = state.people.filter((person) => legacyNames.has(normalizeLegacyText(person.name)));
}

function applyLegacyCsvData(options = {}) {
  const { force = false } = options;
  if (typeof window === "undefined") return;
  const legacy = window.LEGACY_CSV_DATA;
  if (!legacy || !legacy.assignments || !Array.isArray(legacy.people)) return;

  state.legacyImports ||= [];
  const importKey = legacy.version || LEGACY_CSV_IMPORT_KEY;
  if (!force && state.legacyImports.includes(importKey)) return;

  const backupKey = force ? `${STORAGE_KEY}-before-restore-${importKey}-${new Date().toISOString()}` : `${STORAGE_KEY}-before-${importKey}`;
  if (!localStorage.getItem(backupKey)) {
    localStorage.setItem(backupKey, JSON.stringify(state));
  }

  removeDemoOnlyPeopleBeforeLegacyImport(legacy.people);

  const personIdByLegacyName = {};
  legacy.people.forEach((legacyPerson) => {
    personIdByLegacyName[normalizeLegacyText(legacyPerson.name)] = ensureLegacyPerson(legacyPerson);
  });

  const importedMonths = new Set();
  Object.entries(legacy.assignments).forEach(([key, day]) => {
    importedMonths.add(key.slice(0, 7));
    const idsByShift = {};
    SHIFT_TYPES.forEach((shift) => {
      idsByShift[shift] = (Array.isArray(day?.[shift]) ? day[shift] : [])
        .map((name) => personIdByLegacyName[normalizeLegacyText(name)] || ensureLegacyPerson({ name, baseShift: shift }));
    });

    const assigned = new Set();
    const shift24 = uniqueLegacyPeople(idsByShift["24x72"]).slice(0, 2);
    shift24.forEach((personId) => assigned.add(personId));

    const shift12 = uniqueLegacyPeople(idsByShift["12x36"]).filter((personId) => !assigned.has(personId));
    shift12.forEach((personId) => assigned.add(personId));

    const commercial = uniqueLegacyPeople(idsByShift.Comercial).filter((personId) => !assigned.has(personId));

    clearFixedAssignmentsForDate(key);
    state.assignments[key] = normalizeAssignments({
      "24x72": shift24,
      "12x36": shift12,
      Comercial: commercial,
    });
  });

  importedMonths.forEach((key) => {
    state.monthlyShifts[key] ||= {};
    legacy.people.forEach((legacyPerson) => {
      const personId = personIdByLegacyName[normalizeLegacyText(legacyPerson.name)];
      if (personId && (force || !state.monthlyShifts[key][personId])) {
        state.monthlyShifts[key][personId] = PERSON_SHIFT_TYPES.includes(legacyPerson.baseShift) ? legacyPerson.baseShift : "24x72";
      }
    });
  });

  (legacy.restrictions || []).forEach((restriction, index) => {
    const personId = personIdByLegacyName[normalizeLegacyText(restriction.personName)] || findLegacyPersonByName(restriction.personName)?.id;
    if (personId) addLegacyRestriction(restriction, personId, index, importKey);
  });

  if (!state.legacyImports.includes(importKey)) state.legacyImports.push(importKey);
  saveState();
}

applyLegacyCsvData();

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date = currentDate) {
  return date.toISOString().slice(0, 7);
}

function getPersonShift(person, key = monthKey()) {
  return state.monthlyShifts?.[key]?.[person.id] || person.baseShift;
}

function getPersonShiftForDate(person, key) {
  return getPersonShift(person, key.slice(0, 7));
}

function getPersonShiftForDateById(personId, key) {
  const person = findPerson(personId);
  return person ? getPersonShiftForDate(person, key) : null;
}

function isCommercialRegime(shift) {
  return shift === "Comercial" || shift === "Comercial Fixo";
}

function setPersonShift(personId, shift, key = monthKey()) {
  if (!state.monthlyShifts[key]) state.monthlyShifts[key] = {};
  state.monthlyShifts[key][personId] = shift;
  getMonthKeys().forEach((dayKey) => {
    if (shift === "Comercial Fixo") {
      removePersonFromDay(personId, dayKey, "24x72");
      removePersonFromDay(personId, dayKey, "12x36");
    }
  });
}

function shiftClass(shift) {
  return shift.toLowerCase().replace(/\s+/g, "-").replace("x", "x");
}

function fixedKey(dayKey, shift, personId) {
  return `${dayKey}|${shift}|${personId}`;
}

function isFixedAssignment(dayKey, shift, personId) {
  return Boolean(state.fixedAssignments?.[fixedKey(dayKey, shift, personId)]);
}

function getFixedAssignment(dayKey, shift, personId) {
  const value = state.fixedAssignments?.[fixedKey(dayKey, shift, personId)];
  if (!value) return null;
  return typeof value === "object" ? value : { originDate: dayKey, originShift: shift };
}

function setFixedAssignment(dayKey, shift, personId, originDate = dayKey, originShift = shift) {
  state.fixedAssignments ||= {};
  state.fixedAssignments[fixedKey(dayKey, shift, personId)] = { originDate, originShift };
}

function clearFixedAssignment(dayKey, shift, personId) {
  if (!state.fixedAssignments) return;
  delete state.fixedAssignments[fixedKey(dayKey, shift, personId)];
}

function hasFixedAssignmentInDay(personId, dayKey) {
  const day = getAssignments(dayKey);
  return SHIFT_TYPES.some((shift) => day[shift].includes(personId) && isFixedAssignment(dayKey, shift, personId));
}

function keepOnlyFixedAssignments(dayKey, shift) {
  const day = getAssignments(dayKey);
  day[shift] = day[shift].filter((personId) => {
    const keep = isFixedAssignment(dayKey, shift, personId) && findPerson(personId) && !isRestricted(personId, dayKey);
    if (!keep) clearFixedAssignment(dayKey, shift, personId);
    return keep;
  });
  if (shift === "24x72" && day[shift].length > 2) {
    day[shift].slice(2).forEach((personId) => clearFixedAssignment(dayKey, shift, personId));
    day[shift] = day[shift].slice(0, 2);
  }
}

function formatDate(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString("pt-BR");
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getMonthKeys() {
  const total = daysInMonth(currentDate);
  return Array.from({ length: total }, (_, index) => {
    const day = new Date(currentDate.getFullYear(), currentDate.getMonth(), index + 1);
    return dateKey(day);
  });
}

function normalizeAssignments(value) {
  if (Array.isArray(value)) {
    return { "24x72": value.slice(0, 2), "12x36": [], Comercial: [] };
  }
  return {
    "24x72": Array.isArray(value?.["24x72"]) ? value["24x72"].slice(0, 2) : [],
    "12x36": Array.isArray(value?.["12x36"]) ? value["12x36"] : [],
    Comercial: Array.isArray(value?.Comercial) ? value.Comercial : [],
  };
}

function getAssignments(dayKey) {
  if (!state.assignments[dayKey]) state.assignments[dayKey] = normalizeAssignments();
  if (Array.isArray(state.assignments[dayKey])) {
    state.assignments[dayKey] = normalizeAssignments(state.assignments[dayKey]);
  } else {
    SHIFT_TYPES.forEach((shift) => {
      if (!Array.isArray(state.assignments[dayKey][shift])) state.assignments[dayKey][shift] = [];
    });
    state.assignments[dayKey]["24x72"] = state.assignments[dayKey]["24x72"].slice(0, 2);
  }
  return state.assignments[dayKey];
}

function getPeopleInDay(dayKey) {
  const day = getAssignments(dayKey);
  return SHIFT_TYPES.flatMap((shift) => day[shift]);
}

function findPerson(id) {
  if (isEmptySlot(id)) return { id: EMPTY_SLOT_ID, name: "Vazio", baseShift: "24x72" };
  return state.people.find((person) => person.id === id);
}

function isEmptySlot(personId) {
  return personId === EMPTY_SLOT_ID;
}

function isRestricted(personId, key) {
  if (isEmptySlot(personId)) return false;
  return state.restrictions.some((restriction) => {
    return restriction.personId === personId && key >= restriction.start && key <= restriction.end;
  });
}

function isHoliday(key) {
  return state.holidays.some((holiday) => holiday.date === key);
}

function holidayLabelsForDay(key) {
  return state.holidays.filter((holiday) => holiday.date === key).map((holiday) => `Feriado: ${holiday.name}`);
}

function restrictionLabelsForDay(key) {
  return state.restrictions
    .filter((restriction) => key >= restriction.start && key <= restriction.end)
    .map((restriction) => {
      const person = findPerson(restriction.personId);
      return `${person?.name || "Pessoa"}: ${restriction.type}`;
    });
}

function findAssignment(personId, key) {
  const day = getAssignments(key);
  const shift = SHIFT_TYPES.find((item) => day[item].includes(personId));
  return shift ? { key, shift } : null;
}

function lastAssignmentBefore(personId, key) {
  const previous = Object.entries(state.assignments)
    .map(([assignmentKey]) => findAssignment(personId, assignmentKey))
    .filter((assignment) => assignment && assignment.key < key)
    .sort((a, b) => a.key.localeCompare(b.key))
    .pop();
  return previous || null;
}

function hoursSinceLastShift(personId, key) {
  const last = lastAssignmentBefore(personId, key);
  if (!last) return Infinity;
  return effectiveHoursBetween(personId, last.key, key, sourceRestShift(personId, last));
}

function respectsRest(personId, key) {
  const last = lastAssignmentBefore(personId, key);
  if (!last) return true;
  if (hasSuspensionBetween(personId, last.key, key)) return true;
  const sourceShift = sourceRestShift(personId, last);
  return hoursSinceLastShift(personId, key) >= REST_HOURS[sourceShift];
}

function nextAssignmentAfter(personId, key) {
  const next = Object.entries(state.assignments)
    .map(([assignmentKey]) => findAssignment(personId, assignmentKey))
    .filter((assignment) => assignment && assignment.key > key)
    .sort((a, b) => a.key.localeCompare(b.key))
    .shift();
  return next || null;
}

function respectsRestAround(personId, key, targetShift) {
  if (!respectsRest(personId, key)) return false;
  const next = nextAssignmentAfter(personId, key);
  if (!next) return true;
  const currentShift = sourceRestShift(personId, { key, shift: targetShift });
  return effectiveHoursBetween(personId, key, next.key, currentShift) >= REST_HOURS[currentShift];
}

function dayDistance(startKey, endKey) {
  const start = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  return Math.round((end - start) / 864e5);
}

function addDaysKey(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function isWeekend(key) {
  const day = new Date(`${key}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

function isBusinessWorkday(key) {
  return !isWeekend(key) && !isHoliday(key);
}

function isRestSuspendedDay(personId, key) {
  return state.restrictions.some((restriction) => {
    // QUALQUER restrição (Férias, Curso, Atestado, etc.) suspende a contagem de descanso.
    return restriction.personId === personId && key >= restriction.start && key <= restriction.end;
  });
}

function hasPersonalRestrictionDay(personId, key) {
  return state.restrictions.some((restriction) => {
    return restriction.personId === personId && key >= restriction.start && key <= restriction.end;
  });
}

function hasSuspensionBetween(personId, startKey, endKey) {
  const distance = dayDistance(startKey, endKey);
  for (let offset = 1; offset < distance; offset += 1) {
    if (hasPersonalRestrictionDay(personId, addDaysKey(startKey, offset))) {
      return true;
    }
  }
  return false;
}

function suspensionDaysBetween(personId, startKey, endKey) {
  const distance = dayDistance(startKey, endKey);
  let total = 0;
  for (let offset = 1; offset < distance; offset += 1) {
    if (isRestSuspendedDay(personId, addDaysKey(startKey, offset))) total += 1;
  }
  return total;
}

function effectiveDayDistance(personId, startKey, endKey) {
  return Math.max(0, dayDistance(startKey, endKey) - suspensionDaysBetween(personId, startKey, endKey));
}

function commercialEffectiveDayDistance(personId, startKey, endKey) {
  const distance = dayDistance(startKey, endKey);
  let total = 0;
  for (let offset = 1; offset <= distance; offset += 1) {
    const key = addDaysKey(startKey, offset);
    if (isBusinessWorkday(key) && !hasPersonalRestrictionDay(personId, key)) total += 1;
  }
  return total;
}

function sourceRestShift(personId, assignment) {
  // Se o plantão realizado foi 24x72 ou 12x36, o descanso deve ser baseado nesse trabalho,
  // mesmo que a pessoa seja do regime Comercial.
  if (assignment.shift === "24x72" || assignment.shift === "12x36") return assignment.shift;

  const monthlyShift = getPersonShiftForDateById(personId, assignment.key);
  if (isCommercialRegime(monthlyShift)) return "Comercial";
  return assignment.shift;
}

function effectiveHoursBetween(personId, startKey, endKey, sourceShift) {
  if (isCommercialRegime(sourceShift)) {
    return commercialEffectiveDayDistance(personId, startKey, endKey) * 24;
  }
  return effectiveDayDistance(personId, startKey, endKey) * 24;
}

function restBalanceForAssignment(personId, key) {
  if (isEmptySlot(personId)) return 0;
  const previous = lastAssignmentBefore(personId, key);
  if (!previous) return 0;

  const sourceShift = sourceRestShift(personId, previous);
  const expectedGapDays = REST_HOURS[sourceShift] / 24;
  const actualGapDays = isCommercialRegime(sourceShift) ? commercialEffectiveDayDistance(personId, previous.key, key) : effectiveDayDistance(personId, previous.key, key);
  const balance = expectedGapDays - actualGapDays;
  return balance;
}

function restBalanceClass(balance) {
  if (balance > 0) return "owes-rest";
  if (balance < 0) return "extra-rest";
  return "";
}

function restBalanceLabel(balance) {
  if (balance > 0) return `+${balance}`;
  return String(balance);
}

function cardRuleWarnings(person, key, shift, restBalance = 0) {
  if (!person || !key || !shift || isEmptySlot(person.id)) return [];
  const warnings = [];
  const personShift = getPersonShiftForDate(person, key);
  if (isRestricted(person.id, key)) {
    warnings.push("Pessoa possui restrição cadastrada neste dia.");
  }
  if (personShift === "Comercial Fixo" && shift !== "Comercial") {
    warnings.push("Comercial Fixo deve ficar apenas na coluna Comercial.");
  }
  if (shift === "24x72" && getAssignments(key)["24x72"].length > 2) {
    warnings.push("24x72 está com mais de 2 plantonistas neste dia.");
  }
  if (reviewMode && restBalance > 0) {
    warnings.push(`Folga insuficiente: voltou ${restBalance} dia(s) antes do previsto.`);
  }
  if (reviewMode && restBalance < 0) {
    warnings.push(`Folga a mais: voltou ${Math.abs(restBalance)} dia(s) depois do previsto.`);
  }
  return warnings;
}

function personCard(person, subtitle = null, sourceDate = null, sourceShift = null) {
  const personShift = sourceDate ? getPersonShiftForDate(person, sourceDate) : getPersonShift(person);
  const label = subtitle || personShift;
  const card = document.createElement("div");
  card.className = `person-card shift-${shiftClass(personShift)}`;
  if (isEmptySlot(person.id)) card.classList.add("is-empty-slot");
  if (sourceDate && sourceShift && isFixedAssignment(sourceDate, sourceShift, person.id)) {
    card.classList.add("is-fixed");
    card.title = "Card fixo manual";
  }
  const restBalance = sourceDate && reviewMode ? restBalanceForAssignment(person.id, sourceDate) : 0;
  if (restBalance) card.classList.add("has-rest-alert", restBalanceClass(restBalance));
  const warnings = sourceDate && sourceShift ? cardRuleWarnings(person, sourceDate, sourceShift, restBalance) : [];
  if (warnings.length) card.classList.add("has-rule-alert");
  card.draggable = true;
  card.dataset.personId = person.id;
  if (sourceDate) card.dataset.sourceDate = sourceDate;
  if (sourceShift) card.dataset.sourceShift = sourceShift;
  const removeButton = sourceDate ? '<button class="card-remove" type="button" title="Remover card">×</button>' : "";
  const restBadge = restBalance ? `<b class="rest-badge" title="Saldo de folga">${restBalanceLabel(restBalance)}</b>` : "";
  const warningBadge = warnings.length ? `<b class="rule-alert" title="${escapeHtmlValue(warnings.join("\n"))}">!</b>` : "";
  card.innerHTML = `<strong>${person.name}</strong><span>${label}</span>${restBadge}${warningBadge}${removeButton}`;
  card.querySelector(".card-remove")?.addEventListener("click", (event) => {
    event.stopPropagation();
    removePersonFromDay(person.id, sourceDate, sourceShift);
    saveState();
    renderAll();
  });
  card.addEventListener("dragstart", () => {
    draggedPersonId = person.id;
    draggedSourceDate = sourceDate;
    draggedSourceShift = sourceShift;
  });
  card.addEventListener("dragend", () => {
    draggedPersonId = null;
    draggedSourceDate = null;
    draggedSourceShift = null;
    document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  });
  return card;
}

function attachDropZone(element, onDrop) {
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("drag-over");
  });
  element.addEventListener("dragleave", () => element.classList.remove("drag-over"));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("drag-over");
    if (draggedPersonId) onDrop(draggedPersonId);
  });
}

function renderAvailable() {
  els.availableList.innerHTML = "";
  state.people.forEach((person) => els.availableList.appendChild(personCard(person, getPersonShift(person))));
  if (!state.people.length) {
    els.availableList.innerHTML = '<div class="empty-state">Cadastre pessoas na aba Equipe.</div>';
  }
  els.availableCount.textContent = state.people.length;
}

function renderCalendar() {
  const monthName = currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  els.monthTitle.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  els.monthPicker.value = monthKey();
  els.calendarGrid.innerHTML = "";
  applyScaleColumnWidths();

  const header = document.createElement("div");
  header.className = "scale-row scale-head";
  header.innerHTML = `
    <div>Ano</div>
    <div>Mês</div>
    <div>Dia</div>
    <div>Sem</div>
    <div>24x72</div>
    <div>12x36</div>
    <div>Comercial</div>
    <div>Restrições</div>
    <div>Status</div>
  `;
  els.calendarGrid.appendChild(header);

  getMonthKeys().forEach((key) => {
    const fullDate = new Date(`${key}T12:00:00`);
    const day = fullDate.getDate();
    const year = fullDate.getFullYear();
    const month = fullDate.toLocaleDateString("pt-BR", { month: "long" });
    const weekday = fullDate.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
    const assigned = getAssignments(key);
    const assigned24 = assigned["24x72"];
    const capacityClass = assigned24.length >= 2 ? "full" : "missing";
    const row = document.createElement("div");
    row.className = `scale-row ${fullDate.getDay() === 0 || fullDate.getDay() === 6 ? "weekend" : ""}`;
    row.innerHTML = `
      <div class="date-cell">${year}</div>
      <div class="date-cell month-cell">${month}</div>
      <div class="date-cell">${day}</div>
      <div class="weekday-cell">${weekday}</div>
      <div class="scale-slot drop-zone" data-date="${key}" data-shift="24x72"><button class="add-card-button" type="button" title="Adicionar card">+</button></div>
      <div class="scale-slot drop-zone" data-date="${key}" data-shift="12x36"><button class="add-card-button" type="button" title="Adicionar card">+</button></div>
      <div class="scale-slot drop-zone" data-date="${key}" data-shift="Comercial"><button class="add-card-button" type="button" title="Adicionar card">+</button></div>
      <div class="restriction-cell"></div>
      <div><span class="capacity ${capacityClass}">${assigned24.length}/2</span></div>
    `;

    row.querySelectorAll(".drop-zone").forEach((area) => {
      attachDropZone(area, (personId) => assignPerson(personId, key, area.dataset.shift));
      area.querySelector(".add-card-button").addEventListener("click", (event) => {
        event.stopPropagation();
        addCardByClick(key, area.dataset.shift);
      });
    });

    SHIFT_TYPES.forEach((shift) => {
      const cell = row.querySelector(`[data-shift="${shift}"]`);
      assigned[shift].forEach((personId) => {
        const person = findPerson(personId);
        if (!person) return;
        const personShift = getPersonShiftForDate(person, key);
        const subtitle = personShift === shift || (personShift === "Comercial Fixo" && shift === "Comercial") ? personShift : `Remanejado de ${personShift}`;
        cell.insertBefore(personCard(person, subtitle, key, shift), cell.querySelector(".add-card-button"));
      });
    });

    const restrictionCell = row.querySelector(".restriction-cell");
    restrictionLabelsForDay(key).forEach((label) => {
      const chip = document.createElement("div");
      chip.className = "restriction-chip";
      chip.textContent = label;
      restrictionCell.appendChild(chip);
    });
    holidayLabelsForDay(key).forEach((label) => {
      const chip = document.createElement("div");
      chip.className = "holiday-chip";
      chip.textContent = label;
      restrictionCell.appendChild(chip);
    });

    els.calendarGrid.appendChild(row);
  });
}

function applyScaleColumnWidths() {
  const maxCards = { "24x72": 0, "12x36": 0, Comercial: 0 };
  getMonthKeys().forEach((key) => {
    const day = getAssignments(key);
    SHIFT_TYPES.forEach((shift) => {
      maxCards[shift] = Math.max(maxCards[shift], day[shift].length);
    });
  });

  const widthFor = (count, fallback = 92) => {
    if (!count) return `${fallback}px`;
    return `${Math.max(fallback, count * 152 + 38)}px`;
  };

  els.calendarGrid.style.setProperty("--col-24", widthFor(maxCards["24x72"], 170));
  els.calendarGrid.style.setProperty("--col-12", widthFor(maxCards["12x36"], 92));
  els.calendarGrid.style.setProperty("--col-comercial", widthFor(maxCards.Comercial, 92));
}

function removePersonFromDay(personId, key, shift = null, options = {}) {
  const { clearFixed = true } = options;
  const day = getAssignments(key);
  const shifts = shift ? [shift] : SHIFT_TYPES;
  shifts.forEach((item) => {
    day[item] = day[item].filter((id) => id !== personId);
    if (clearFixed) clearFixedAssignment(key, item, personId);
  });
}

function countAssignmentsUntil(personId, targetShift, key) {
  return Object.keys(state.assignments).filter((assignmentKey) => {
    return assignmentKey < key && getAssignments(assignmentKey)[targetShift].includes(personId);
  }).length;
}

function assignPerson(personId, key, targetShift) {
  const person = findPerson(personId);
  if (!person || !targetShift) return;
  const originDate = draggedSourceDate || key;
  const originShift = draggedSourceShift || targetShift;
  const sourceSnapshot =
    draggedSourceDate && draggedSourceShift
      ? {
          key: draggedSourceDate,
          shift: draggedSourceShift,
          wasFixed: isFixedAssignment(draggedSourceDate, draggedSourceShift, personId),
        }
      : null;

  if (sourceSnapshot && (sourceSnapshot.key !== key || sourceSnapshot.shift !== targetShift)) {
    removePersonFromDay(personId, sourceSnapshot.key, sourceSnapshot.shift);
  }

  SHIFT_TYPES.forEach((shift) => {
    if (shift !== targetShift) removePersonFromDay(personId, key, shift);
  });

  const targetAssignments = getAssignments(key)[targetShift];
  if (!targetAssignments.includes(personId)) {
    targetAssignments.push(personId);
    setFixedAssignment(key, targetShift, personId, originDate, originShift);
  }

  const targetHasCard = getAssignments(key)[targetShift].includes(personId);
  if (!targetHasCard && sourceSnapshot) {
    const sourceAssignments = getAssignments(sourceSnapshot.key)[sourceSnapshot.shift];
    if (!sourceAssignments.includes(personId)) sourceAssignments.push(personId);
    if (sourceSnapshot.wasFixed) setFixedAssignment(sourceSnapshot.key, sourceSnapshot.shift, personId, sourceSnapshot.key, sourceSnapshot.shift);
  }
  saveState();
  renderAll();
}

function addCardByClick(key, targetShift) {
  const options = state.people
    .filter((person) => !getAssignments(key)[targetShift].includes(person.id));
  if (targetShift === "24x72") options.push(findPerson(EMPTY_SLOT_ID));
  if (!options.length) return;
  const list = options.map((person, index) => `${index + 1}. ${person.name} (${getPersonShift(person)})`).join("\n");
  const answer = prompt(`Adicionar em ${formatDate(key)} - ${targetShift}\n\n${list}\n\nDigite o número:`);
  if (!answer) return;
  const person = options[Number(answer) - 1];
  if (!person) return;
  assignPerson(person.id, key, targetShift);
}

function removeFromSourceDay(personId) {
  if (!draggedSourceDate) return;
  removePersonFromDay(personId, draggedSourceDate, draggedSourceShift);
  saveState();
  renderAll();
}

function calculateCumulativeBalanceToDate(personId, targetKey) {
  if (isEmptySlot(personId)) return 0;
  let total = 0;
  Object.keys(state.assignments)
    .filter((k) => k < targetKey)
    .sort((a, b) => a.localeCompare(b))
    .forEach((k) => {
      const day = getAssignments(k);
      if (SHIFT_TYPES.some((shift) => day[shift].includes(personId))) {
        total += restBalanceForAssignment(personId, k);
      }
    });
  return total;
}

function pairSignature(pair) {
  return pair.join("|");
}

function orderedReal24Pair(key) {
  const pair = getAssignments(key)["24x72"].filter((personId) => !isEmptySlot(personId) && findPerson(personId));
  return pair.length === 2 ? pair : null;
}

function fallback24Pairs(monthKeys) {
  const people24 = state.people.filter((person) => getPersonShift(person) === "24x72" && monthKeys.some((key) => !isRestricted(person.id, key)));
  const pairs = [];
  for (let index = 0; index < people24.length; index += 2) {
    const first = people24[index]?.id;
    const second = people24[index + 1]?.id || people24[0]?.id;
    if (first && second && first !== second) pairs.push([first, second]);
  }
  return pairs;
}

function extend24PairCycle(pairs, monthKeys) {
  const covered = new Set(pairs.flat());
  const missing = state.people
    .filter((person) => getPersonShift(person) === "24x72")
    .filter((person) => monthKeys.some((key) => !isRestricted(person.id, key)))
    .filter((person) => !covered.has(person.id));

  const expanded = [...pairs];
  for (let index = 0; index < missing.length; index += 2) {
    const first = missing[index];
    const second = missing[index + 1] || state.people.find((person) => {
      return getPersonShift(person) === "24x72" && person.id !== first.id && monthKeys.some((key) => !isRestricted(person.id, key));
    });
    if (first && second) expanded.push([first.id, second.id]);
  }
  return expanded;
}

function getHistorical24PairCycle(monthKeys) {
  const firstKey = monthKeys[0];
  const historyPairs = Object.keys(state.assignments)
    .filter((key) => key < firstKey)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => orderedReal24Pair(key))
    .filter(Boolean);

  if (!historyPairs.length) {
    return { pairs: fallback24Pairs(monthKeys), startIndex: 0 };
  }

  const reversedCycle = [];
  const seen = new Set();
  for (let index = historyPairs.length - 1; index >= 0; index -= 1) {
    const pair = historyPairs[index];
    const signature = pairSignature(pair);
    if (seen.has(signature) && reversedCycle.length > 1) break;
    if (!seen.has(signature)) {
      seen.add(signature);
      reversedCycle.push(pair);
    }
  }

  const pairs = extend24PairCycle(reversedCycle.reverse(), monthKeys);
  const lastSignature = pairSignature(historyPairs[historyPairs.length - 1]);
  const lastIndex = pairs.findIndex((pair) => pairSignature(pair) === lastSignature);
  return { pairs, startIndex: lastIndex >= 0 ? (lastIndex + 1) % pairs.length : 0 };
}

function canUsePersonOnDay(personId, key, targetShift) {
  const person = findPerson(personId);
  if (!person || isEmptySlot(personId)) return false;
  if (isRestricted(personId, key)) return false;
  if (hasFixedAssignmentInDay(personId, key)) return false;
  if (getPersonShiftForDate(person, key) === "Comercial Fixo" && targetShift !== "Comercial") return false;
  if (getPeopleInDay(key).includes(personId)) return false;
  return true;
}

function restIndexCandidateScore(person, key, targetShift, monthKeys) {
  const balance = restBalanceForAssignment(person.id, key);
  const cumulative = calculateCumulativeBalanceToDate(person.id, key);
  const projected = cumulative + balance;
  const personShift = getPersonShiftForDate(person, key);
  const regimePenalty = personShift === targetShift ? 0 : personShift === "24x72" ? 1 : personShift === "12x36" ? 2 : 4;
  const workedThisMonth = countMonthTotalAssignments(person.id, monthKeys);

  return {
    person,
    balance,
    projected,
    regimePenalty,
    workedThisMonth,
  };
}

function compareRestIndexCandidates(a, b) {
  const absA = Math.abs(a.balance);
  const absB = Math.abs(b.balance);
  if (absA !== absB) return absA - absB;
  if ((a.balance < 0) !== (b.balance < 0)) return a.balance < 0 ? -1 : 1;
  if (Math.abs(a.projected) !== Math.abs(b.projected)) return Math.abs(a.projected) - Math.abs(b.projected);
  if (a.regimePenalty !== b.regimePenalty) return a.regimePenalty - b.regimePenalty;
  if (a.workedThisMonth !== b.workedThisMonth) return a.workedThisMonth - b.workedThisMonth;
  return a.person.name.localeCompare(b.person.name);
}

function chooseBalancedCandidate(key, targetShift, monthKeys) {
  const candidates = state.people
    .filter((person) => canUsePersonOnDay(person.id, key, targetShift))
    .map((person) => restIndexCandidateScore(person, key, targetShift, monthKeys))
    .sort(compareRestIndexCandidates);

  return candidates[0]?.person || null;
}

function placePersonInShift(key, targetShift, personId) {
  const day = getAssignments(key);
  SHIFT_TYPES.forEach((shift) => {
    if (shift !== targetShift) day[shift] = day[shift].filter((id) => id !== personId);
  });
  if (!day[targetShift].includes(personId)) day[targetShift].push(personId);
}

function fill24DayWithPreferredPair(key, preferredPair, monthKeys) {
  const day = getAssignments(key);
  day["24x72"] = day["24x72"].filter((personId) => {
    return isFixedAssignment(key, "24x72", personId) && findPerson(personId) && !isRestricted(personId, key);
  }).slice(0, 2);

  const fixedCount = day["24x72"].length;
  if (fixedCount >= 2) return day["24x72"];

  preferredPair.forEach((personId) => {
    if (day["24x72"].length >= 2) return;
    if (day["24x72"].includes(personId)) return;
    if (!canUsePersonOnDay(personId, key, "24x72")) return;
    placePersonInShift(key, "24x72", personId);
  });

  while (day["24x72"].length < 2) {
    const person = chooseBalancedCandidate(key, "24x72", monthKeys);
    if (!person) {
      day["24x72"].push(EMPTY_SLOT_ID);
      continue;
    }
    placePersonInShift(key, "24x72", person.id);
  }

  return day["24x72"];
}

function fillCommercialByAvailability(monthKeys) {
  clearNonFixedShift(monthKeys, "Comercial");
  monthKeys.forEach((key) => {
    if (!isBusinessWorkday(key)) return;
    const day = getAssignments(key);
    state.people
      .filter((person) => isCommercialRegime(getPersonShiftForDate(person, key)))
      .filter((person) => !getPeopleInDay(key).includes(person.id))
      .filter((person) => !isRestricted(person.id, key))
      .filter((person) => !hasFixedAssignmentInDay(person.id, key))
      .filter((person) => respectsRestAround(person.id, key, "Comercial"))
      .forEach((person) => {
        day.Comercial.push(person.id);
      });
  });
}

function placeMissingPersonInOwnRegime(person, monthKeys) {
  const personShift = getPersonShift(person);
  const targetShift = isCommercialRegime(personShift) ? "Comercial" : personShift;

  if (targetShift === "24x72") {
    const placements = monthKeys
      .filter((key) => canUsePersonOnDay(person.id, key, "24x72"))
      .flatMap((key) => {
        const day = getAssignments(key);
        if (day["24x72"].length < 2) return [{ key, slotIndex: day["24x72"].length, append: true }];
        return day["24x72"]
          .map((personId, slotIndex) => ({ personId, slotIndex }))
          .filter(({ personId }) => !isFixedAssignment(key, "24x72", personId))
          .filter(({ personId }) => !isRequiredPlantonista(findPerson(personId), monthKeys) || countMonthTotalAssignments(personId, monthKeys) > 1)
          .map(({ slotIndex }) => ({ key, slotIndex, append: false }));
      })
      .map((placement) => ({
        ...placement,
        balance: restBalanceForAssignment(person.id, placement.key),
      }))
      .sort((a, b) => Math.abs(a.balance) - Math.abs(b.balance) || (a.balance < b.balance ? -1 : 1));

    const placement = placements[0];
    if (!placement) return false;
    if (placement.append) appendPersonIn24Slot(placement.key, person.id);
    else placePersonIn24Slot(placement.key, placement.slotIndex, person.id);
    return true;
  }

  const candidateKeys = monthKeys.filter((key) => {
    if (targetShift === "Comercial" && !isBusinessWorkday(key)) return false;
    return canUsePersonOnDay(person.id, key, targetShift);
  });
  if (!candidateKeys.length) return false;

  const bestKey = candidateKeys
    .map((key) => ({
      key,
      balance: restBalanceForAssignment(person.id, key),
    }))
    .sort((a, b) => Math.abs(a.balance) - Math.abs(b.balance) || (a.balance < b.balance ? -1 : 1))[0].key;

  placePersonInShift(bestKey, targetShift, person.id);
  return true;
}

function ensureEveryAvailablePersonWorks(monthKeys) {
  state.people.forEach((person) => {
    if (!monthKeys.some((key) => !isRestricted(person.id, key))) return;
    if (countMonthTotalAssignments(person.id, monthKeys) > 0) return;
    placeMissingPersonInOwnRegime(person, monthKeys);
  });
}

function autoFillOptimized() {
  const monthKeys = getMonthKeys();
  monthKeys.forEach((key) => {
    SHIFT_TYPES.forEach((shift) => keepOnlyFixedAssignments(key, shift));
  });

  const cycle = getHistorical24PairCycle(monthKeys);
  let cursor = cycle.startIndex || 0;
  monthKeys.forEach((key) => {
    const preferredPair = cycle.pairs[cursor] || [];
    const placedPair = fill24DayWithPreferredPair(key, preferredPair, monthKeys);
    const placedSignature = placedPair.length === 2 ? pairSignature(placedPair) : null;
    const matchedIndex = placedSignature ? cycle.pairs.findIndex((pair) => pairSignature(pair) === placedSignature) : -1;
    if (matchedIndex >= 0) {
      cursor = (matchedIndex + 1) % cycle.pairs.length;
    } else if (cycle.pairs.length) {
      cursor = (cursor + 1) % cycle.pairs.length;
    }
  });

  optimize12x36Pattern(monthKeys);
  fillCommercialByAvailability(monthKeys);
  ensureEveryAvailablePersonWorks(monthKeys);
  saveState();
  renderAll();
}

function calculateMonthBalance(personId, monthKeys) {
  return monthKeys.reduce((total, key) => {
    const day = getAssignments(key);
    if (!SHIFT_TYPES.some((shift) => day[shift].includes(personId))) return total;
    return total + restBalanceForAssignment(personId, key);
  }, 0);
}

function cloneDayAssignments(day) {
  return {
    "24x72": [...day["24x72"]],
    "12x36": [...day["12x36"]],
    Comercial: [...day.Comercial],
  };
}

function restoreDayAssignments(key, snapshot) {
  const day = getAssignments(key);
  SHIFT_TYPES.forEach((shift) => {
    day[shift] = [...snapshot[shift]];
  });
}

function placePersonIn24Slot(key, slotIndex, personId) {
  const day = getAssignments(key);
  SHIFT_TYPES.forEach((shift) => {
    if (shift !== "24x72") day[shift] = day[shift].filter((id) => id !== personId);
  });
  day["24x72"][slotIndex] = personId;
}

function appendPersonIn24Slot(key, personId) {
  const day = getAssignments(key);
  SHIFT_TYPES.forEach((shift) => {
    if (shift !== "24x72") day[shift] = day[shift].filter((id) => id !== personId);
  });
  if (!day["24x72"].includes(personId) && day["24x72"].length < 2) day["24x72"].push(personId);
}

function assignedShiftInDay(personId, key) {
  const day = getAssignments(key);
  return SHIFT_TYPES.find((shift) => day[shift].includes(personId)) || null;
}

function countMonthAssignments(personId, shift, monthKeys = getMonthKeys()) {
  return monthKeys.reduce((total, key) => {
    return total + (getAssignments(key)[shift].includes(personId) ? 1 : 0);
  }, 0);
}

function countMonthTotalAssignments(personId, monthKeys = getMonthKeys()) {
  return SHIFT_TYPES.reduce((total, shift) => total + countMonthAssignments(personId, shift, monthKeys), 0);
}

function isRequiredPlantonista(person, monthKeys = getMonthKeys()) {
  if (!person || isEmptySlot(person.id)) return false;
  const personShift = getPersonShift(person);
  if (!["24x72", "12x36"].includes(personShift)) return false;
  return monthKeys.some((key) => !isRestricted(person.id, key));
}

function calculateMonthScore(monthKeys = getMonthKeys()) {
  let score = 0;
  const people24 = state.people.filter((person) => getPersonShift(person) === "24x72");
  const available24Total = people24.reduce((total, person) => {
    return total + monthKeys.filter((key) => !isRestricted(person.id, key)).length;
  }, 0);
  const total24Slots = monthKeys.length * 2;

  monthKeys.forEach((key) => {
    const day = getAssignments(key);
    score += Math.pow(Math.max(0, 2 - day["24x72"].length), 2) * 10000;
    SHIFT_TYPES.forEach((shift) => {
      day[shift].forEach((personId) => {
        const balance = restBalanceForAssignment(personId, key);
        score += Math.pow(balance, 2) * 120 + Math.abs(balance) * 20;
      });
    });
  });
  state.people.forEach((person) => {
    const personShift = getPersonShift(person);
    const totalWork = SHIFT_TYPES.reduce((total, shift) => total + countMonthAssignments(person.id, shift, monthKeys), 0);
    const availableDays = monthKeys.filter((key) => !isRestricted(person.id, key)).length;
    if (availableDays && !totalWork) score += 100000;

    if (personShift === "24x72" && available24Total) {
      const shifts24 = countMonthAssignments(person.id, "24x72", monthKeys);
      const expected24 = (total24Slots * availableDays) / available24Total;
      score += Math.pow(shifts24 - expected24, 2) * 25;
    }

    if (personShift === "12x36") {
      const shifts12 = countMonthAssignments(person.id, "12x36", monthKeys);
      const shifts24 = countMonthAssignments(person.id, "24x72", monthKeys);
      const expectedWork = Math.max(1, Math.floor(availableDays / 2));
      score += shifts12 === 0 ? 50000 : 2000 / shifts12;
      score += Math.pow(shifts12 + shifts24 - expectedWork, 2) * 6;
    }
    if (personShift === "Comercial") {
      const shiftsBusiness = countMonthAssignments(person.id, "Comercial", monthKeys);
      const expectedBusiness = monthKeys.filter((key) => isBusinessWorkday(key) && !isRestricted(person.id, key)).length;
      score += shiftsBusiness === 0 && expectedBusiness ? 50000 : 0;
      score += Math.pow(shiftsBusiness - expectedBusiness, 2) * 3;
    }
    const balance = calculateMonthBalance(person.id, monthKeys);
    score += Math.pow(balance, 2) + Math.abs(balance) * 0.01;
  });
  return score;
}

function uncoveredPlantonists(monthKeys = getMonthKeys()) {
  return state.people.filter((person) => {
    return isRequiredPlantonista(person, monthKeys) && countMonthTotalAssignments(person.id, monthKeys) === 0;
  });
}

function repairMissingBaseRegimes(monthKeys = getMonthKeys()) {
  state.people.forEach((person) => {
    const personShift = getPersonShift(person);
    if (personShift === "12x36" && countMonthAssignments(person.id, "12x36", monthKeys) === 0) {
      monthKeys.forEach((key, index) => {
        const personIndex = state.people.filter((item) => getPersonShift(item) === "12x36").findIndex((item) => item.id === person.id);
        const shouldWork = (index + personIndex) % 2 === 0;
        const day = getAssignments(key);
        if (shouldWork && !getPeopleInDay(key).includes(person.id) && !isRestricted(person.id, key) && respectsRestAround(person.id, key, "12x36")) {
          day["12x36"].push(person.id);
        }
      });
    }

    if (personShift === "Comercial" && countMonthAssignments(person.id, "Comercial", monthKeys) === 0) {
      monthKeys.forEach((key) => {
        const day = getAssignments(key);
        if (isBusinessWorkday(key) && !getPeopleInDay(key).includes(person.id) && !isRestricted(person.id, key) && respectsRestAround(person.id, key, "Comercial")) {
          day.Comercial.push(person.id);
        }
      });
    }
  });
}

function cloneMonthAssignments(monthKeys) {
  return Object.fromEntries(monthKeys.map((key) => [key, cloneDayAssignments(getAssignments(key))]));
}

function restoreMonthAssignments(snapshot) {
  Object.entries(snapshot).forEach(([key, day]) => restoreDayAssignments(key, day));
}

function clearNonFixedShift(monthKeys, shift) {
  monthKeys.forEach((key) => {
    const day = getAssignments(key);
    day[shift] = day[shift].filter((personId) => isFixedAssignment(key, shift, personId));
  });
}

function isHardValidDay(key) {
  const day = getAssignments(key);
  const seen = new Set();
  if (day["24x72"].length > 2) return false;
  for (const shift of SHIFT_TYPES) {
    for (const personId of day[shift]) {
      const person = findPerson(personId);
      if (!person || isRestricted(personId, key)) return false;
      if (!isEmptySlot(personId) && seen.has(personId)) return false;
      if (getPersonShiftForDate(person, key) === "Comercial Fixo" && shift !== "Comercial") return false;
      if (!isEmptySlot(personId)) seen.add(personId);
    }
  }
  return true;
}

function isHardValidMonth(monthKeys) {
  return monthKeys.every((key) => isHardValidDay(key));
}

function moveKey(move) {
  if (move.type === "replace") return `${move.type}|${move.key}|${move.slotIndex}|${move.personInId}`;
  return `${move.type}|${move.slotA.key}|${move.slotA.slotIndex}|${move.slotB.key}|${move.slotB.slotIndex}`;
}

function applyOptimizationMove(move) {
  if (move.type === "replace") {
    placePersonIn24Slot(move.key, move.slotIndex, move.personInId);
    return;
  }

  const dayA = getAssignments(move.slotA.key);
  const dayB = getAssignments(move.slotB.key);
  dayA[move.slotA.shift][move.slotA.slotIndex] = move.slotB.personId;
  dayB[move.slotB.shift][move.slotB.slotIndex] = move.slotA.personId;
}

function generateOptimizationMoves(monthKeys) {
  const moves = [];
  const slots = monthKeys.flatMap((key) => {
    const day = getAssignments(key);
    return day["24x72"].map((personId, slotIndex) => ({ key, shift: "24x72", slotIndex, personId }));
  });

  monthKeys.forEach((key) => {
    const day = getAssignments(key);
    day["24x72"].forEach((personOutId, slotIndex) => {
      if (isFixedAssignment(key, "24x72", personOutId)) return;

      state.people
        .filter((person) => person.id !== personOutId)
        .filter((person) => !day["24x72"].includes(person.id))
        .filter((person) => getPersonShift(person) !== "Comercial Fixo")
        .filter((person) => !isRestricted(person.id, key))
        .filter((person) => !hasFixedAssignmentInDay(person.id, key))
        .filter((person) => {
          const sourceShift = assignedShiftInDay(person.id, key);
          if (!sourceShift || sourceShift === "24x72") return true;
          return countMonthAssignments(person.id, sourceShift, monthKeys) > 1;
        })
        .forEach((personIn) => {
          moves.push({ type: "replace", key, slotIndex, personInId: personIn.id });
        });
    });
  });

  slots.forEach((slotA, indexA) => {
    if (isFixedAssignment(slotA.key, slotA.shift, slotA.personId)) return;
    if (getPersonShift(findPerson(slotA.personId)) === "Comercial Fixo") return;

    slots.slice(indexA + 1).forEach((slotB) => {
      if (slotA.key === slotB.key) return;
      if (isFixedAssignment(slotB.key, slotB.shift, slotB.personId)) return;
      if (getPersonShift(findPerson(slotB.personId)) === "Comercial Fixo") return;
      if (isRestricted(slotA.personId, slotB.key) || isRestricted(slotB.personId, slotA.key)) return;
      if (hasFixedAssignmentInDay(slotA.personId, slotB.key) || hasFixedAssignmentInDay(slotB.personId, slotA.key)) return;
      moves.push({ type: "swap", slotA, slotB });
    });
  });

  const seen = new Set();
  return moves.filter((move) => {
    const key = moveKey(move);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreMove(move, monthKeys) {
  const snapshot = cloneMonthAssignments(monthKeys);
  applyOptimizationMove(move);
  const score = isHardValidMonth(monthKeys) ? calculateMonthScore(monthKeys) : Infinity;
  restoreMonthAssignments(snapshot);
  return score;
}

function rankedOptimizationMoves(monthKeys) {
  return generateOptimizationMoves(monthKeys)
    .map((move) => ({ move, score: scoreMove(move, monthKeys) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score);
}

function findBestLookahead(monthKeys, currentScore) {
  const snapshot = cloneMonthAssignments(monthKeys);
  let best = null;
  const firstMoves = rankedOptimizationMoves(monthKeys).slice(0, 12);

  firstMoves.forEach((first) => {
    restoreMonthAssignments(snapshot);
    applyOptimizationMove(first.move);
    const secondMoves = rankedOptimizationMoves(monthKeys).slice(0, 12);

    secondMoves.forEach((second) => {
      restoreMonthAssignments(snapshot);
      applyOptimizationMove(first.move);
      applyOptimizationMove(second.move);
      if (!isHardValidMonth(monthKeys)) return;
      const score = calculateMonthScore(monthKeys);
      if (score + 0.0001 < currentScore && (!best || score < best.score)) {
        best = { moves: [first.move, second.move], score };
      }
    });
  });

  restoreMonthAssignments(snapshot);
  return best;
}

function lastAssignmentsBeforeMonth(monthKeys) {
  const firstKey = monthKeys[0];
  return Object.fromEntries(
    state.people.map((person) => {
      return [person.id, lastAssignmentBefore(person.id, firstKey)];
    }),
  );
}

function fixedPeopleInDay(key, targetShift = null) {
  const day = getAssignments(key);
  return SHIFT_TYPES.flatMap((shift) => {
    if (targetShift && shift === targetShift) return [];
    return day[shift].filter((personId) => isFixedAssignment(key, shift, personId));
  });
}

function balanceFromPrevious(personId, previous, key) {
  if (!previous) return 0;
  const sourceShift = sourceRestShift(personId, previous);
  const expectedGapDays = REST_HOURS[sourceShift] / 24;
  const actualGapDays = isCommercialRegime(sourceShift)
    ? commercialEffectiveDayDistance(personId, previous.key, key)
    : effectiveDayDistance(personId, previous.key, key);
  return expectedGapDays - actualGapDays;
}

function beamPersonDayScore(personId, previous, key) {
  if (isEmptySlot(personId)) return 2600;
  const balance = balanceFromPrevious(personId, previous, key);
  const personShift = getPersonShiftForDateById(personId, key);
  const remapPenalty = personShift === "24x72" ? 0 : personShift === "12x36" ? 18 : 35;
  return Math.pow(balance, 2) * 140 + Math.abs(balance) * 22 + remapPenalty;
}

function complete24PairsForDay(key) {
  const fixed24 = getAssignments(key)["24x72"].filter((personId) => isFixedAssignment(key, "24x72", personId));
  if (fixed24.length > 2) return [];
  const blocked = new Set(fixedPeopleInDay(key, "24x72"));
  const candidates = state.people
    .filter((person) => !fixed24.includes(person.id))
    .filter((person) => !blocked.has(person.id))
    .filter((person) => getPersonShiftForDate(person, key) !== "Comercial Fixo")
    .filter((person) => !isRestricted(person.id, key))
    .map((person) => person.id);
  const candidatesWithEmpty = fixed24.includes(EMPTY_SLOT_ID) ? candidates : [...candidates, EMPTY_SLOT_ID];

  if (fixed24.length === 2) return [fixed24];
  if (fixed24.length === 1) {
    if (!candidatesWithEmpty.length) return [[fixed24[0], EMPTY_SLOT_ID]];
    return candidatesWithEmpty.map((id) => [fixed24[0], id]);
  }
  if (!candidates.length) return [[EMPTY_SLOT_ID, EMPTY_SLOT_ID]];

  const pairs = [];
  for (let i = 0; i < candidatesWithEmpty.length; i += 1) {
    for (let j = i + 1; j < candidatesWithEmpty.length; j += 1) {
      pairs.push([candidatesWithEmpty[i], candidatesWithEmpty[j]]);
    }
  }
  return pairs;
}

function finalBeamScore(beam, monthKeys) {
  let score = beam.score;
  const people24 = state.people.filter((person) => getPersonShift(person) === "24x72");
  const available24Total = people24.reduce((total, person) => {
    return total + monthKeys.filter((key) => !isRestricted(person.id, key)).length;
  }, 0);
  const total24Slots = monthKeys.length * 2;

  state.people.forEach((person) => {
    const availableDays = monthKeys.filter((key) => !isRestricted(person.id, key)).length;
    const count24 = beam.counts[person.id] || 0;
    const personShift = getPersonShift(person);

    if (personShift === "24x72" && available24Total) {
      const expected = (total24Slots * availableDays) / available24Total;
      score += Math.pow(count24 - expected, 2) * 45;
      if (availableDays && count24 === 0) score += 80000;
    }

    if (personShift === "12x36") {
      score += Math.pow(count24, 2) * 12;
    }

    if (personShift === "Comercial") {
      score += Math.pow(count24, 2) * 25;
    }
  });
  const emptyCount = Object.values(beam.assignments).flat().filter((personId) => isEmptySlot(personId)).length;
  score += emptyCount * 2200;

  return score;
}

function build24x72WithBeam(monthKeys) {
  const beamWidth = 80;
  let beams = [
    {
      score: 0,
      assignments: {},
      counts: {},
      last: lastAssignmentsBeforeMonth(monthKeys),
    },
  ];

  monthKeys.forEach((key) => {
    const pairs = complete24PairsForDay(key);
    const nextBeams = [];

    beams.forEach((beam) => {
      pairs.forEach((pair) => {
        const nextLast = { ...beam.last };
        const nextCounts = { ...beam.counts };
        let score = beam.score;

        pair.forEach((personId) => {
          score += beamPersonDayScore(personId, nextLast[personId], key);
          if (!isEmptySlot(personId)) {
            nextLast[personId] = { key, shift: "24x72" };
            nextCounts[personId] = (nextCounts[personId] || 0) + 1;
          }
        });

        nextBeams.push({
          score,
          assignments: { ...beam.assignments, [key]: pair },
          counts: nextCounts,
          last: nextLast,
        });
      });
    });

    beams = nextBeams
      .sort((a, b) => a.score - b.score)
      .slice(0, beamWidth);
  });

  return beams.sort((a, b) => finalBeamScore(a, monthKeys) - finalBeamScore(b, monthKeys))[0] || null;
}

function pairCycleMatchIndex(pair, cyclePairs) {
  const signature = pairSignature(pair);
  return cyclePairs.findIndex((cyclePair) => pairSignature(cyclePair) === signature);
}

function samePairIgnoringOrder(pair, preferredPair) {
  return pair.length === 2 && preferredPair.length === 2 && pair.every((personId) => preferredPair.includes(personId));
}

function pairPreferenceScore(pair, preferredPair, cyclePairs, key) {
  if (pair.some((personId) => isEmptySlot(personId))) return 120000;
  if (preferredPair.length === 2 && pairSignature(pair) === pairSignature(preferredPair)) return 0;
  if (samePairIgnoringOrder(pair, preferredPair)) return 250;

  const preferredMatches = pair.filter((personId) => preferredPair.includes(personId)).length;
  if (preferredMatches === 1) return 1800;

  if (pairCycleMatchIndex(pair, cyclePairs) >= 0) return 900;
  if (cyclePairs.some((cyclePair) => samePairIgnoringOrder(pair, cyclePair))) return 1300;

  const base24Count = pair.filter((personId) => getPersonShiftForDateById(personId, key) === "24x72").length;
  return base24Count === 2 ? 2400 : 4200;
}

function completePersonDayScore(personId, previous, key) {
  if (isEmptySlot(personId)) return 90000;
  const balance = balanceFromPrevious(personId, previous, key);
  const personShift = getPersonShiftForDateById(personId, key);
  const regimePenalty = personShift === "24x72" ? 0 : personShift === "12x36" ? 4500 : 9000;
  const balancePenalty = Math.pow(balance, 2) * 2600 + Math.abs(balance) * 650;
  const earlyPenalty = balance > 0 ? 180 : 0;
  return balancePenalty + regimePenalty + earlyPenalty;
}

function completePairDayScore(pair, previousMap, key, preferredPair, cyclePairs) {
  let score = pairPreferenceScore(pair, preferredPair, cyclePairs, key);
  pair.forEach((personId) => {
    score += completePersonDayScore(personId, previousMap[personId], key);
  });
  return score;
}

function rankedCompletePairOptions(key, previousMap, preferredPair, cyclePairs) {
  return complete24PairsForDay(key)
    .map((pair) => ({
      pair,
      score: completePairDayScore(pair, previousMap, key, preferredPair, cyclePairs),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 80);
}

function finalCompleteBeamScore(beam, monthKeys, cyclePairs) {
  let score = beam.score;
  const people24 = state.people.filter((person) => getPersonShift(person) === "24x72");
  const available24Total = people24.reduce((total, person) => {
    return total + monthKeys.filter((key) => !isRestricted(person.id, key)).length;
  }, 0);
  const total24Slots = monthKeys.length * 2;

  state.people.forEach((person) => {
    const availableDays = monthKeys.filter((key) => !isRestricted(person.id, key)).length;
    if (!availableDays) return;
    const count24 = beam.counts[person.id] || 0;
    const personShift = getPersonShift(person);

    if (personShift === "24x72") {
      if (count24 === 0) score += 250000;
      if (available24Total) {
        const expected = (total24Slots * availableDays) / available24Total;
        score += Math.pow(count24 - expected, 2) * 180;
      }
    }

    if (personShift === "12x36") score += Math.pow(count24, 2) * 3500;
    if (personShift === "Comercial") score += Math.pow(count24, 2) * 6500;
    if (personShift === "Comercial Fixo" && count24) score += 500000;
  });

  const emptyCount = Object.values(beam.assignments).flat().filter((personId) => isEmptySlot(personId)).length;
  score += emptyCount * 180000;

  const usedCyclePairs = Object.values(beam.assignments).filter((pair) => pairCycleMatchIndex(pair, cyclePairs) >= 0).length;
  score -= usedCyclePairs * 80;

  return score;
}

function buildCompleteScored24x72(monthKeys) {
  const cycle = getHistorical24PairCycle(monthKeys);
  const cyclePairs = cycle.pairs.length ? cycle.pairs : fallback24Pairs(monthKeys);
  const beamWidth = 120;
  let beams = [
    {
      score: 0,
      assignments: {},
      counts: {},
      last: lastAssignmentsBeforeMonth(monthKeys),
      cursor: cycle.startIndex || 0,
    },
  ];

  monthKeys.forEach((key) => {
    const nextBeams = [];
    beams.forEach((beam) => {
      const preferredPair = cyclePairs[beam.cursor] || [];
      rankedCompletePairOptions(key, beam.last, preferredPair, cyclePairs).forEach((option) => {
        const nextLast = { ...beam.last };
        const nextCounts = { ...beam.counts };
        option.pair.forEach((personId) => {
          if (!isEmptySlot(personId)) {
            nextLast[personId] = { key, shift: "24x72" };
            nextCounts[personId] = (nextCounts[personId] || 0) + 1;
          }
        });

        const matchedIndex = pairCycleMatchIndex(option.pair, cyclePairs);
        const nextCursor = cyclePairs.length ? (matchedIndex >= 0 ? matchedIndex + 1 : beam.cursor + 1) % cyclePairs.length : 0;
        nextBeams.push({
          score: beam.score + option.score,
          assignments: { ...beam.assignments, [key]: option.pair },
          counts: nextCounts,
          last: nextLast,
          cursor: nextCursor,
        });
      });
    });

    beams = nextBeams
      .sort((a, b) => a.score - b.score)
      .slice(0, beamWidth);
  });

  return beams.sort((a, b) => finalCompleteBeamScore(a, monthKeys, cyclePairs) - finalCompleteBeamScore(b, monthKeys, cyclePairs))[0] || null;
}

function findBestCoveragePlacement(person, monthKeys) {
  const snapshot = cloneMonthAssignments(monthKeys);
  let best = null;

  monthKeys.forEach((key) => {
    if (isRestricted(person.id, key) || hasFixedAssignmentInDay(person.id, key)) return;
    const day = getAssignments(key);
    const indexes = day["24x72"].length < 2 ? [day["24x72"].length] : [0, 1];

    indexes.forEach((slotIndex) => {
      const currentPersonId = day["24x72"][slotIndex];
      if (currentPersonId && isFixedAssignment(key, "24x72", currentPersonId)) return;
      if (currentPersonId && !isEmptySlot(currentPersonId)) {
        const currentPerson = findPerson(currentPersonId);
        if (currentPerson && isRequiredPlantonista(currentPerson, monthKeys) && countMonthTotalAssignments(currentPersonId, monthKeys) <= 1) return;
      }

      restoreMonthAssignments(snapshot);
      const shouldAppend = slotIndex >= getAssignments(key)["24x72"].length;
      if (shouldAppend) {
        appendPersonIn24Slot(key, person.id);
      } else {
        placePersonIn24Slot(key, slotIndex, person.id);
      }
      if (!isHardValidMonth(monthKeys)) return;
      const score = calculateMonthScore(monthKeys) + uncoveredPlantonists(monthKeys).length * 100000;
      if (!best || score < best.score) best = { key, slotIndex, append: shouldAppend, score };
    });
  });

  restoreMonthAssignments(snapshot);
  return best;
}

function ensureAllPlantonistsCovered(monthKeys = getMonthKeys()) {
  let fixed = 0;
  let missing = uncoveredPlantonists(monthKeys);
  while (missing.length && fixed < state.people.length) {
    const person = missing[0];
    const placement = findBestCoveragePlacement(person, monthKeys);
    if (!placement) break;
    if (placement.append) {
      appendPersonIn24Slot(placement.key, person.id);
    } else {
      placePersonIn24Slot(placement.key, placement.slotIndex, person.id);
    }
    fixed += 1;
    missing = uncoveredPlantonists(monthKeys);
  }
  return uncoveredPlantonists(monthKeys);
}

function place12x36Pattern(people12, phases, monthKeys) {
  clearNonFixedShift(monthKeys, "12x36");
  people12.forEach((person, personIndex) => {
    const phase = phases[personIndex];
    monthKeys.forEach((key, dayIndex) => {
      if ((dayIndex + phase) % 2 !== 0) return;
      const day = getAssignments(key);
      if (day["12x36"].includes(person.id)) return;
      if (getPeopleInDay(key).includes(person.id)) return;
      if (isRestricted(person.id, key) || hasFixedAssignmentInDay(person.id, key)) return;
      day["12x36"].push(person.id);
    });
  });
}

function score12x36Pattern(people12, monthKeys) {
  let score = 0;
  monthKeys.forEach((key) => {
    const day = getAssignments(key);
    if (people12.length > 1 && day["12x36"].length > 1) score += Math.pow(day["12x36"].length - 1, 2) * 35;
    day["12x36"].forEach((personId) => {
      const balance = restBalanceForAssignment(personId, key);
      score += Math.pow(balance, 2) * 900 + Math.abs(balance) * 120;
    });
  });

  people12.forEach((person) => {
    const availableDays = monthKeys.filter((key) => !isRestricted(person.id, key)).length;
    const expectedWork = Math.max(1, Math.floor(availableDays / 2));
    const totalWork = countMonthAssignments(person.id, "12x36", monthKeys) + countMonthAssignments(person.id, "24x72", monthKeys);
    if (availableDays && totalWork === 0) score += 100000;
    score += Math.pow(totalWork - expectedWork, 2) * 40;
  });

  return score;
}

function optimize12x36Pattern(monthKeys = getMonthKeys()) {
  const people12 = state.people.filter((person) => getPersonShift(person) === "12x36");
  if (!people12.length) return;

  const snapshot = cloneMonthAssignments(monthKeys);
  let best = null;
  const combinations = Math.pow(2, Math.min(people12.length, 12));

  for (let mask = 0; mask < combinations; mask += 1) {
    const phases = people12.map((_, index) => (mask >> (index % 12)) & 1);
    restoreMonthAssignments(snapshot);
    place12x36Pattern(people12, phases, monthKeys);
    const score = score12x36Pattern(people12, monthKeys);
    if (!best || score < best.score) best = { phases, score };
  }

  restoreMonthAssignments(snapshot);
  if (best) place12x36Pattern(people12, best.phases, monthKeys);
}

function refineScheduleWithLocalSearch() {
  const monthKeys = getMonthKeys();
  getMonthKeys().forEach((key) => {
    SHIFT_TYPES.forEach((shift) => keepOnlyFixedAssignments(key, shift));
  });
  const best = build24x72WithBeam(monthKeys);
  if (!best) {
    alert("Não encontrei uma combinação viável para preencher o 24x72 com as restrições atuais.");
    return;
  }

  monthKeys.forEach((key) => {
    const day = getAssignments(key);
    day["24x72"] = best.assignments[key] || [];
    day["24x72"].forEach((personId) => {
      day["12x36"] = day["12x36"].filter((id) => id !== personId);
      day.Comercial = day.Comercial.filter((id) => id !== personId);
    });
  });
  autoFillBaseRegimes();
  optimize12x36Pattern(monthKeys);
  repairMissingBaseRegimes(monthKeys);
  saveState();
  renderAll();
  alert("Equilíbrio global concluído com geração por busca rápida.");
}

function autoFillCompleteCoverage() {
  const monthKeys = getMonthKeys();
  monthKeys.forEach((key) => {
    SHIFT_TYPES.forEach((shift) => keepOnlyFixedAssignments(key, shift));
  });

  const best = buildCompleteScored24x72(monthKeys);
  if (!best) {
    alert("Não encontrei uma combinação viável para preencher o 24x72 com as restrições atuais.");
    return;
  }

  monthKeys.forEach((key) => {
    const day = getAssignments(key);
    day["24x72"] = best.assignments[key] || [];
    day["24x72"].forEach((personId) => {
      day["12x36"] = day["12x36"].filter((id) => id !== personId);
      day.Comercial = day.Comercial.filter((id) => id !== personId);
    });
  });

  optimize12x36Pattern(monthKeys);
  fillCommercialByAvailability(monthKeys);
  ensureEveryAvailablePersonWorks(monthKeys);
  const stillMissing = state.people.filter((person) => {
    return monthKeys.some((key) => !isRestricted(person.id, key)) && countMonthTotalAssignments(person.id, monthKeys) === 0;
  });
  saveState();
  renderAll();
  if (stillMissing.length) {
    alert(`Preenchimento concluído, mas não consegui encaixar: ${stillMissing.map((person) => person.name).join(", ")}.`);
  } else {
    alert("Preenchimento inteligente completo concluído sem deixar plantonista fora do mês.");
  }
}

function chooseCandidate(key, targetShift, alreadyAssigned = []) {
  const candidates = state.people
    .filter((person) => !alreadyAssigned.includes(person.id))
    .filter((person) => !hasFixedAssignmentInDay(person.id, key))
    .filter((person) => getPersonShift(person) !== "Comercial Fixo" || targetShift === "Comercial")
    .filter((person) => !isRestricted(person.id, key))
    .map((person) => {
      const rest = hoursSinceLastShift(person.id, key);
      const personShift = getPersonShift(person);
      const basePenalty = personShift === targetShift ? 0 : personShift === "12x36" ? 1 : 2;
      return {
        person,
        rest,
        basePenalty,
        shiftCount: countAssignmentsUntil(person.id, targetShift, key),
        respectsRest: respectsRestAround(person.id, key, targetShift),
      };
    })
    .sort((a, b) => {
      if (a.respectsRest !== b.respectsRest) return a.respectsRest ? -1 : 1;
      if (!a.respectsRest && a.rest !== b.rest) return b.rest - a.rest;
      return a.basePenalty - b.basePenalty || a.shiftCount - b.shiftCount || b.rest - a.rest || a.person.name.localeCompare(b.person.name);
    });
  return candidates[0]?.person || (targetShift === "24x72" ? findPerson(EMPTY_SLOT_ID) : null);
}

function autoFillBaseRegimes() {
  getMonthKeys().forEach((key) => {
    keepOnlyFixedAssignments(key, "12x36");
    keepOnlyFixedAssignments(key, "Comercial");
  });

  getMonthKeys().forEach((key, index) => {
    const date = new Date(`${key}T12:00:00`);
    const day = getAssignments(key);

    state.people
      .filter((person) => getPersonShift(person) === "12x36")
      .forEach((person, personIndex) => {
        const shouldWork = (index + personIndex) % 2 === 0;
        if (shouldWork && !getPeopleInDay(key).includes(person.id) && !isRestricted(person.id, key) && respectsRestAround(person.id, key, "12x36")) {
          day["12x36"].push(person.id);
        }
      });

    if (isBusinessWorkday(key)) {
      state.people
        .filter((person) => ["Comercial", "Comercial Fixo"].includes(getPersonShift(person)))
        .forEach((person) => {
          if (!getPeopleInDay(key).includes(person.id) && !isRestricted(person.id, key) && respectsRestAround(person.id, key, "Comercial")) {
            day.Comercial.push(person.id);
          }
        });
    }
  });
}

function autoFill24x72() {
  getMonthKeys().forEach((key) => {
    SHIFT_TYPES.forEach((shift) => keepOnlyFixedAssignments(key, shift));
  });
  getMonthKeys().forEach((key) => {
    const day = getAssignments(key);
    day["24x72"] = day["24x72"].filter((id) => findPerson(id) && !isRestricted(id, key)).slice(0, 2);
    while (day["24x72"].length < 2) {
      const person = chooseCandidate(key, "24x72", day["24x72"]);
      if (!person) break;
      if (isEmptySlot(person.id)) {
        day["24x72"].push(person.id);
        continue;
      }
      removePersonFromDay(person.id, key);
      day["24x72"].push(person.id);
    }
  });
  autoFillBaseRegimes();
  saveState();
  renderAll();
}

function clearCurrentMonth() {
  if (!confirm("Limpar toda a escala deste mês?")) return;
  getMonthKeys().forEach((key) => {
    const day = getAssignments(key);
    SHIFT_TYPES.forEach((shift) => {
      day[shift].forEach((personId) => clearFixedAssignment(key, shift, personId));
      day[shift] = [];
    });
    Object.keys(state.fixedAssignments || {})
      .filter((item) => item.startsWith(`${key}|`))
      .forEach((item) => delete state.fixedAssignments[item]);
  });
  saveState();
  renderAll();
}

function exportBackup() {
  const payload = {
    app: "Escala EVR",
    exportedAt: new Date().toISOString(),
    version: 1,
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `escala-evr-backup-${monthKey(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvPersonName(personId) {
  if (!personId || isEmptySlot(personId)) return "";
  return formatNameForCsv(findPerson(personId)?.name || "");
}

function formatNameForCsv(name) {
  return String(name || "")
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|\s|-|')(\p{L})/gu, (match, separator, letter) => `${separator}${letter.toLocaleUpperCase("pt-BR")}`);
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[;"\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportMonthCsv() {
  const selectedMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const monthKeys = Array.from({ length: daysInMonth(selectedMonth) }, (_, index) => {
    const day = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), index + 1);
    return dateKey(day);
  });
  const maxCommercial = monthKeys.reduce((max, key) => {
    return Math.max(max, getAssignments(key).Comercial.length);
  }, 0);
  const headers = ["24h 1", "24h 2", "12x36", ...Array.from({ length: maxCommercial }, (_, index) => `Comercial ${index + 1}`)];
  const rows = monthKeys.map((key) => {
    const day = getAssignments(key);
    const commercialNames = Array.from({ length: maxCommercial }, (_, index) => csvPersonName(day.Comercial[index]));
    return [
      csvPersonName(day["24x72"][0]),
      csvPersonName(day["24x72"][1]),
      day["12x36"].map(csvPersonName).filter(Boolean).join(" / "),
      ...commercialNames,
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(";")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `escala-evr-${monthKey(selectedMonth)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incomingState = parsed.state || parsed;
      const restored = normalizeLoadedState(incomingState);
      if (!restored.people.length) {
        alert("Arquivo inválido: não encontrei equipe cadastrada no backup.");
        return;
      }
      if (!confirm("Carregar este backup vai substituir os dados atuais salvos neste navegador. Continuar?")) return;
      state = restored;
      saveState();
      renderAll();
      alert("Backup carregado com sucesso.");
    } catch (error) {
      alert("Não consegui carregar este arquivo. Verifique se ele é um backup JSON da Escala EVR.");
    } finally {
      els.importFile.value = "";
    }
  });
  reader.readAsText(file);
}

function syncDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function updateSyncStatus(message = null, tone = "") {
  if (!els.syncStatus) return;
  els.syncStatus.className = tone ? `sync-status ${tone}` : "sync-status";
  if (message) {
    els.syncStatus.textContent = message;
    return;
  }
  if (syncMeta.dirty) {
    els.syncStatus.textContent = `Nuvem: alterações locais${syncMeta.version ? ` (v${syncMeta.version})` : ""}`;
    els.syncStatus.classList.add("dirty");
    return;
  }
  if (syncMeta.version) {
    els.syncStatus.textContent = `Nuvem: sincronizado v${syncMeta.version}${syncMeta.updatedAt ? ` - ${syncDateLabel(syncMeta.updatedAt)}` : ""}`;
    els.syncStatus.classList.add("ok");
    return;
  }
  els.syncStatus.textContent = "Nuvem: não sincronizado";
}

function setSyncBusy(isBusy) {
  [els.syncPull, els.syncPush].forEach((button) => {
    if (button) button.disabled = isBusy;
  });
}

async function requestCloudState() {
  const response = await fetch(`${SYNC_ENDPOINT}?action=load&t=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
  const data = await readCloudJson(response);
  if (!data.ok) throw new Error(data.error || "Resposta inválida da nuvem.");
  return data;
}

async function readCloudJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    if (text.includes("accounts.google.com") || text.includes("signin")) {
      throw new Error("Apps Script pediu login. Reimplante o app como acesso: Qualquer pessoa.");
    }
    throw new Error("A nuvem não respondeu JSON válido.");
  }
}

async function pullFromCloud() {
  try {
    setSyncBusy(true);
    updateSyncStatus("Nuvem: baixando...", "busy");
    const data = await requestCloudState();
    if (!data.exists || !data.state) {
      updateSyncStatus("Nuvem: ainda vazia", "dirty");
      alert("Ainda não existe escala salva na nuvem. Use Enviar para nuvem primeiro.");
      return;
    }
    if (syncMeta.dirty && !confirm("Existem alterações locais ainda não enviadas. Baixar da nuvem vai substituir este navegador. Continuar?")) {
      updateSyncStatus();
      return;
    }
    const previousRawState = localStorage.getItem(STORAGE_KEY);
    if (previousRawState) pushUndoSnapshot(previousRawState);
    state = normalizeLoadedState(data.state);
    syncMeta = {
      version: Number(data.version || 0),
      updatedAt: data.updatedAt || null,
      lastSyncedAt: new Date().toISOString(),
      dirty: false,
    };
    persistUndoStack();
    saveState({ skipUndo: true, skipSyncDirty: true });
    persistSyncMeta();
    renderAll();
    alert("Escala baixada da nuvem com sucesso.");
  } catch (error) {
    updateSyncStatus("Nuvem: erro ao baixar", "error");
    alert(`Não consegui baixar da nuvem. ${error.message || error}`);
  } finally {
    setSyncBusy(false);
  }
}

async function pushToCloud(force = false) {
  try {
    setSyncBusy(true);
    updateSyncStatus("Nuvem: enviando...", "busy");
    const response = await fetch(SYNC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "save",
        state,
        version: syncMeta.version || 0,
        force,
        source: location.href,
      }),
    });
    const data = await readCloudJson(response);
    if (data.conflict) {
      setSyncBusy(false);
      updateSyncStatus(`Nuvem: conflito v${data.currentVersion}`, "error");
      if (confirm("Existe uma versão mais nova na nuvem. Deseja sobrescrever mesmo assim com esta escala local?")) {
        await pushToCloud(true);
      }
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
    syncMeta = {
      version: Number(data.version || 0),
      updatedAt: data.updatedAt || null,
      lastSyncedAt: new Date().toISOString(),
      dirty: false,
    };
    persistSyncMeta();
    updateSyncStatus("Nuvem: enviado com sucesso", "ok");
    setTimeout(() => updateSyncStatus(), 1800);
  } catch (error) {
    updateSyncStatus("Nuvem: erro ao enviar", "error");
    alert(`Não consegui enviar para a nuvem. ${error.message || error}`);
  } finally {
    setSyncBusy(false);
  }
}

function restoreLegacyCsvData() {
  if (!window.LEGACY_CSV_DATA) {
    alert("Não encontrei o arquivo legacy-data.js para restaurar os dados antigos.");
    return;
  }
  if (!confirm("Restaurar os dados antigos vai substituir novamente as escalas importadas da planilha. Continuar?")) return;
  applyLegacyCsvData({ force: true });
  renderAll();
  alert("Dados antigos restaurados com sucesso.");
}

function workedHoursForPersonOnDay(personId, key) {
  const day = getAssignments(key);
  if (day["24x72"].includes(personId)) return SHIFT_HOURS["24x72"];
  if (day["12x36"].includes(personId)) return SHIFT_HOURS["12x36"];
  if (day.Comercial.includes(personId)) return SHIFT_HOURS.Comercial;
  return 0;
}

function restHoursForPersonOnDay(personId, key) {
  if (isRestricted(personId, key)) return 0;
  return Math.max(0, 24 - workedHoursForPersonOnDay(personId, key));
}

function getTimelineStartKey() {
  const assignmentKeys = Object.keys(state.assignments || {});
  const restrictionKeys = (state.restrictions || []).map((restriction) => restriction.start);
  return [...assignmentKeys, ...restrictionKeys].filter(Boolean).sort((a, b) => a.localeCompare(b))[0] || getMonthKeys()[0];
}

function keysBetween(startKey, endKey) {
  const total = dayDistance(startKey, endKey);
  return Array.from({ length: total + 1 }, (_, index) => addDaysKey(startKey, index));
}

function formatRestDays(hours) {
  const days = hours / 24;
  const formatted = Number.isInteger(days) ? String(days) : days.toFixed(1).replace(".", ",");
  return `${formatted}d`;
}

function calculateStats() {
  return state.people.map((person) => {
    const stats = {
      person,
      month: {
        shifts24: 0,
        shifts12: 0,
        shiftsBusiness: 0,
        hours24: 0,
        hours12: 0,
        hoursBusiness: 0,
        workedHours: 0,
        restHours: 0,
        restDays: 0,
        restBalance: 0,
        restAlerts: 0,
        restrictions: 0,
      },
      accumulated: {
        shifts24: 0,
        shifts12: 0,
        shiftsBusiness: 0,
        hours24: 0,
        hours12: 0,
        hoursBusiness: 0,
        workedHours: 0,
        restHours: 0,
        restDays: 0,
        restBalance: 0,
        restAlerts: 0,
        restrictions: 0,
      },
    };

    const monthKeys = getMonthKeys();
    const lastDayOfMonth = monthKeys[monthKeys.length - 1];
    const accumulatedKeys = keysBetween(getTimelineStartKey(), lastDayOfMonth);

    Object.keys(state.assignments)
      .filter((k) => k <= lastDayOfMonth)
      .sort((a, b) => a.localeCompare(b))
      .forEach((k) => {
        const day = getAssignments(k);
        const inCurrentMonth = monthKeys.includes(k);

        if (day["24x72"].includes(person.id)) {
          stats.accumulated.shifts24 += 1;
          stats.accumulated.hours24 += SHIFT_HOURS["24x72"];
          stats.accumulated.workedHours += SHIFT_HOURS["24x72"];
          if (inCurrentMonth) {
            stats.month.shifts24 += 1;
            stats.month.hours24 += SHIFT_HOURS["24x72"];
            stats.month.workedHours += SHIFT_HOURS["24x72"];
          }
        }
        if (day["12x36"].includes(person.id)) {
          stats.accumulated.shifts12 += 1;
          stats.accumulated.hours12 += SHIFT_HOURS["12x36"];
          stats.accumulated.workedHours += SHIFT_HOURS["12x36"];
          if (inCurrentMonth) {
            stats.month.shifts12 += 1;
            stats.month.hours12 += SHIFT_HOURS["12x36"];
            stats.month.workedHours += SHIFT_HOURS["12x36"];
          }
        }
        if (day.Comercial.includes(person.id)) {
          stats.accumulated.shiftsBusiness += 1;
          stats.accumulated.hoursBusiness += SHIFT_HOURS.Comercial;
          stats.accumulated.workedHours += SHIFT_HOURS.Comercial;
          if (inCurrentMonth) {
            stats.month.shiftsBusiness += 1;
            stats.month.hoursBusiness += SHIFT_HOURS.Comercial;
            stats.month.workedHours += SHIFT_HOURS.Comercial;
          }
        }

        if (SHIFT_TYPES.some((shift) => day[shift].includes(person.id))) {
          const balance = restBalanceForAssignment(person.id, k);
          stats.accumulated.restBalance += balance;
          if (balance !== 0) {
            stats.accumulated.restAlerts += 1;
          }
          if (inCurrentMonth) {
            stats.month.restBalance += balance;
            if (balance !== 0) {
              stats.month.restAlerts += 1;
            }
          }
        }
      });

    monthKeys.forEach((key) => {
      if (isRestricted(person.id, key)) stats.month.restrictions += 1;
      stats.month.restHours += restHoursForPersonOnDay(person.id, key);
    });

    accumulatedKeys.forEach((key) => {
      stats.accumulated.restHours += restHoursForPersonOnDay(person.id, key);
    });

    state.restrictions.forEach((restriction) => {
      if (restriction.personId !== person.id) return;
      const start = restriction.start <= lastDayOfMonth ? restriction.start : null;
      if (!start) return;
      const end = restriction.end < lastDayOfMonth ? restriction.end : lastDayOfMonth;
      if (end < start) return;
      stats.accumulated.restrictions += dayDistance(start, addDaysKey(end, 1));
    });

    stats.month.restDays = stats.month.restHours / 24;
    stats.accumulated.restDays = stats.accumulated.restHours / 24;
    stats.month.ratio24VsOther = ratio24VsOther(stats.month);
    stats.accumulated.ratio24VsOther = ratio24VsOther(stats.accumulated);
    return stats;
  });
}

function ratio24VsOther(group) {
  const otherHours = group.hours12 + group.hoursBusiness;
  if (!group.hours24 && !otherHours) return 0;
  if (!otherHours) return Infinity;
  return group.hours24 / otherHours;
}

function formatRatio(value) {
  if (!Number.isFinite(value)) return "Sem base";
  return value.toFixed(2).replace(".", ",");
}

function renderStatsRanking(statsList) {
  const ranking = statsList
    .map((stats) => {
      const otherHours = stats.accumulated.hours12 + stats.accumulated.hoursBusiness;
      return {
        person: stats.person,
        hours24: stats.accumulated.hours24,
        otherHours,
        ratio: stats.accumulated.ratio24VsOther,
      };
    })
    .sort((a, b) => {
      if (Number.isFinite(a.ratio) !== Number.isFinite(b.ratio)) return Number.isFinite(a.ratio) ? 1 : -1;
      return b.ratio - a.ratio || b.hours24 - a.hours24 || a.person.name.localeCompare(b.person.name);
    });

  els.statsRanking.innerHTML = `
    <article class="ranking-card">
      <div class="ranking-head">
        <div>
          <h3>Ranking 24h / demais horas</h3>
          <p>Acumulado até ${currentDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</p>
        </div>
      </div>
      <div class="ranking-list">
        ${ranking
          .map(
            (item, index) => `
              <div class="ranking-row">
                <strong>${index + 1}</strong>
                <span>${item.person.name}</span>
                <b>${formatRatio(item.ratio)}</b>
                <small>${item.hours24}h em 24x72 / ${item.otherHours}h em 12x36 + comercial</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderStats() {
  els.statsGrid.innerHTML = "";
  const statsList = calculateStats();
  renderStatsRanking(statsList);
  statsList.forEach((stats) => {
    const card = document.createElement("article");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-head">
        <div>
          <h3>${stats.person.name}</h3>
          <span>Regime do mês: ${getPersonShift(stats.person)}</span>
        </div>
      </div>
      <h4 class="metric-section-title">Mês selecionado</h4>
      <div class="stat-metrics">
        <div class="metric"><strong>${stats.month.shifts24}</strong><span>Plantões 24x72</span></div>
        <div class="metric"><strong>${stats.month.shifts12}</strong><span>Escalas 12x36</span></div>
        <div class="metric"><strong>${stats.month.shiftsBusiness}</strong><span>Dias comerciais</span></div>
        <div class="metric"><strong>${stats.month.workedHours}h</strong><span>Horas trabalhadas</span></div>
        <div class="metric"><strong>${formatRatio(stats.month.ratio24VsOther)}</strong><span>24h / outras horas</span></div>
        <div class="metric"><strong>${formatRestDays(stats.month.restHours)}</strong><span>Total de folgas</span></div>
        <div class="metric"><strong>${stats.month.restHours}h</strong><span>Horas de folga</span></div>
        <div class="metric ${restBalanceClass(stats.month.restBalance)}"><strong>${restBalanceLabel(stats.month.restBalance)}</strong><span>Saldo folga do mês</span></div>
        <div class="metric"><strong>${stats.month.restAlerts}</strong><span>Pontos de conferência</span></div>
        <div class="metric"><strong>${stats.month.restrictions}</strong><span>Dias com restrição</span></div>
      </div>
      <h4 class="metric-section-title">Acumulado até este mês</h4>
      <div class="stat-metrics">
        <div class="metric"><strong>${stats.accumulated.shifts24}</strong><span>Plantões 24x72</span></div>
        <div class="metric"><strong>${stats.accumulated.shifts12}</strong><span>Escalas 12x36</span></div>
        <div class="metric"><strong>${stats.accumulated.shiftsBusiness}</strong><span>Dias comerciais</span></div>
        <div class="metric"><strong>${stats.accumulated.workedHours}h</strong><span>Horas trabalhadas</span></div>
        <div class="metric"><strong>${formatRatio(stats.accumulated.ratio24VsOther)}</strong><span>24h / outras horas</span></div>
        <div class="metric"><strong>${formatRestDays(stats.accumulated.restHours)}</strong><span>Total de folgas</span></div>
        <div class="metric"><strong>${stats.accumulated.restHours}h</strong><span>Horas de folga</span></div>
        <div class="metric ${restBalanceClass(stats.accumulated.restBalance)}"><strong>${restBalanceLabel(stats.accumulated.restBalance)}</strong><span>Saldo folga acumulado</span></div>
        <div class="metric"><strong>${stats.accumulated.restAlerts}</strong><span>Pontos de conferência</span></div>
        <div class="metric"><strong>${stats.accumulated.restrictions}</strong><span>Dias com restrição</span></div>
      </div>
    `;
    els.statsGrid.appendChild(card);
  });
}

function renderPeople() {
  els.peopleList.innerHTML = "";
  els.restrictionPerson.innerHTML = "";

  state.people.forEach((person) => {
    const selectedShift = getPersonShift(person);
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = person.name;
    els.restrictionPerson.appendChild(option);

    const row = document.createElement("article");
    row.className = "person-row";
    row.innerHTML = `
      <div>
        <h3>${person.name}</h3>
        <p>Regime deste mês</p>
      </div>
      <select class="row-shift-select" data-shift-person="${person.id}">
        ${PERSON_SHIFT_TYPES.map((shift) => `<option value="${shift}" ${shift === selectedShift ? "selected" : ""}>${shift}</option>`).join("")}
      </select>
      <button class="danger-action" data-remove-person="${person.id}">Remover</button>
    `;
    els.peopleList.appendChild(row);
  });

  if (!state.people.length) {
    els.peopleList.innerHTML = '<div class="empty-state">Cadastre a primeira pessoa da equipe.</div>';
  }
}

function restrictionTypeOptions(selectedType) {
  const types = [...new Set([...RESTRICTION_TYPES, selectedType].filter(Boolean))];
  return types.map((type) => `<option value="${type}" ${type === selectedType ? "selected" : ""}>${type}</option>`).join("");
}

function restrictionPersonOptions(selectedPersonId) {
  return state.people
    .map((person) => `<option value="${person.id}" ${person.id === selectedPersonId ? "selected" : ""}>${person.name}</option>`)
    .join("");
}

function escapeHtmlValue(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function restrictionMonthKeys() {
  const months = new Set();
  state.restrictions.forEach((restriction) => {
    let key = restriction.start.slice(0, 7);
    const end = restriction.end.slice(0, 7);
    while (key <= end) {
      months.add(key);
      key = monthKey(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1));
    }
  });
  return [...months].sort((a, b) => a.localeCompare(b));
}

function renderRestrictionFilter() {
  if (!els.restrictionFilter) return;
  const currentValue = restrictionFilterValue;
  const currentMonth = monthKey();
  const monthOptions = restrictionMonthKeys()
    .map((key) => `<option value="${key}" ${currentValue === key ? "selected" : ""}>${monthLabel(key)}</option>`)
    .join("");

  els.restrictionFilter.innerHTML = `
    <option value="all" ${currentValue === "all" ? "selected" : ""}>Tudo</option>
    <option value="current" ${currentValue === "current" ? "selected" : ""}>Mês selecionado (${monthLabel(currentMonth)})</option>
    ${monthOptions}
  `;
}

function restrictionMatchesFilter(restriction) {
  if (restrictionFilterValue === "all") return true;
  const filterMonth = restrictionFilterValue === "current" ? monthKey() : restrictionFilterValue;
  const start = `${filterMonth}-01`;
  const end = addDaysKey(monthKey(new Date(Number(filterMonth.slice(0, 4)), Number(filterMonth.slice(5, 7)), 1)), -1);
  return restriction.start <= end && restriction.end >= start;
}

function renderRestrictionEditItem(restriction, person) {
  return `
    <div class="restriction-edit-grid">
      <label>
        Pessoa
        <select data-edit-field="personId">${restrictionPersonOptions(restriction.personId)}</select>
      </label>
      <label>
        Tipo
        <select data-edit-field="type">${restrictionTypeOptions(restriction.type)}</select>
      </label>
      <label>
        Início
        <input data-edit-field="start" type="date" value="${restriction.start}" />
      </label>
      <label>
        Fim
        <input data-edit-field="end" type="date" value="${restriction.end}" />
      </label>
      <label class="wide">
        Observação
        <input data-edit-field="note" type="text" value="${escapeHtmlValue(restriction.note)}" />
      </label>
    </div>
    <div class="restriction-actions">
      <button class="primary-action compact-action" type="button" data-save-restriction="${restriction.id}">Salvar</button>
      <button class="secondary-action compact-action" type="button" data-cancel-restriction-edit="${restriction.id}">Cancelar</button>
      <button class="danger-action" type="button" data-remove-restriction="${restriction.id}">Remover</button>
    </div>
  `;
}

function renderRestrictionViewItem(restriction, person) {
  return `
    <div>
      <h3>${person?.name || "Pessoa removida"} - ${restriction.type}</h3>
      <p>${formatDate(restriction.start)} até ${formatDate(restriction.end)}${restriction.note ? ` - ${restriction.note}` : ""}</p>
    </div>
    <div class="restriction-actions">
      <button class="secondary-action compact-action" type="button" data-edit-restriction="${restriction.id}">Editar</button>
      <button class="danger-action" type="button" data-remove-restriction="${restriction.id}">Remover</button>
    </div>
  `;
}

function updateRestrictionFromEditItem(id) {
  const item = els.restrictionList.querySelector(`[data-restriction-id="${id}"]`);
  if (!item) return;
  const valueFor = (field) => item.querySelector(`[data-edit-field="${field}"]`)?.value || "";
  const start = valueFor("start");
  const end = valueFor("end");
  if (!start || !end || end < start) {
    alert("Verifique as datas da restrição.");
    return;
  }

  const restriction = state.restrictions.find((entry) => entry.id === id);
  if (!restriction) return;
  restriction.personId = valueFor("personId");
  restriction.type = valueFor("type");
  restriction.start = start;
  restriction.end = end;
  restriction.note = valueFor("note").trim();

  Object.keys(state.assignments).forEach((key) => {
    if (key >= start && key <= end) {
      removePersonFromDay(restriction.personId, key);
    }
  });

  editingRestrictionId = null;
  saveState();
  renderAll();
}

function renderRestrictions() {
  renderRestrictionFilter();
  els.restrictionList.innerHTML = "";
  const filteredRestrictions = state.restrictions
    .slice()
    .filter(restrictionMatchesFilter)
    .sort((a, b) => a.start.localeCompare(b.start));
  filteredRestrictions.forEach((restriction) => {
    const person = findPerson(restriction.personId);
    const item = document.createElement("article");
    item.className = `restriction-item ${editingRestrictionId === restriction.id ? "is-editing" : ""}`;
    item.dataset.restrictionId = restriction.id;
    item.innerHTML = editingRestrictionId === restriction.id ? renderRestrictionEditItem(restriction, person) : renderRestrictionViewItem(restriction, person);
    els.restrictionList.appendChild(item);
  });

  if (!filteredRestrictions.length) {
    els.restrictionList.innerHTML = state.restrictions.length
      ? '<div class="empty-state">Nenhuma restrição neste filtro.</div>'
      : '<div class="empty-state">Nenhuma restrição cadastrada.</div>';
  }

  els.holidayList.innerHTML = "";
  state.holidays
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((holiday) => {
      const item = document.createElement("article");
      item.className = "restriction-item holiday-item";
      item.innerHTML = `
        <div>
          <h3>${holiday.name}</h3>
          <p>${formatDate(holiday.date)}</p>
        </div>
        <button class="danger-action" data-remove-holiday="${holiday.id}">Remover</button>
      `;
      els.holidayList.appendChild(item);
    });

  if (!state.holidays.length) {
    els.holidayList.innerHTML = '<div class="empty-state">Nenhum feriado cadastrado.</div>';
  }
}

function renderAll() {
  renderCalendar();
  renderAvailable();
  renderStats();
  renderPeople();
  renderRestrictions();
  updateUndoButton();
  if (els.checkScale) els.checkScale.textContent = reviewMode ? "Ocultar conferência" : "Conferir escala";
  updateSyncStatus();
}

els.tabs.forEach((button) => {
  button.addEventListener("click", () => {
    els.tabs.forEach((tab) => tab.classList.remove("active"));
    els.pages.forEach((page) => page.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(`${button.dataset.tab}-tab`).classList.add("active");
  });
});

els.prevMonth.addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderAll();
});

els.nextMonth.addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderAll();
});

els.monthPicker.addEventListener("change", (event) => {
  const [year, month] = event.target.value.split("-").map(Number);
  currentDate = new Date(year, month - 1, 1);
  renderAll();
});

els.autoFill.addEventListener("click", autoFill24x72);
document.getElementById("optimize-balance").addEventListener("click", autoFillOptimized);
els.optimizeComplete.addEventListener("click", autoFillCompleteCoverage);
document.getElementById("refine-balance").addEventListener("click", refineScheduleWithLocalSearch);
els.undoAction?.addEventListener("click", undoLastChange);
els.checkScale.addEventListener("click", () => {
  reviewMode = !reviewMode;
  els.checkScale.textContent = reviewMode ? "Ocultar conferência" : "Conferir escala";
  renderAll();
});
els.exportData.addEventListener("click", exportBackup);
els.exportCsv?.addEventListener("click", exportMonthCsv);
els.importData.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", (event) => importBackupFile(event.target.files[0]));
els.syncPull?.addEventListener("click", pullFromCloud);
els.syncPush?.addEventListener("click", () => pushToCloud(false));
els.restoreLegacy?.addEventListener("click", restoreLegacyCsvData);
els.clearMonth.addEventListener("click", clearCurrentMonth);

attachDropZone(els.availableList, removeFromSourceDay);

els.personForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.people.push({
    id: crypto.randomUUID(),
    name: els.personName.value.trim(),
    baseShift: els.personShift.value,
  });
  els.personForm.reset();
  saveState();
  renderAll();
});

els.peopleList.addEventListener("click", (event) => {
  const id = event.target.dataset.removePerson;
  if (!id) return;
  if (!confirm("Remover esta pessoa e suas escalas/restrições?")) return;
  state.people = state.people.filter((person) => person.id !== id);
  Object.keys(state.assignments).forEach((key) => {
    removePersonFromDay(id, key);
  });
  state.restrictions = state.restrictions.filter((restriction) => restriction.personId !== id);
  saveState();
  renderAll();
});

els.peopleList.addEventListener("change", (event) => {
  const id = event.target.dataset.shiftPerson;
  if (!id) return;
  setPersonShift(id, event.target.value);
  saveState();
  renderAll();
});

els.restrictionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const start = els.restrictionStart.value;
  const end = els.restrictionEnd.value;
  if (end < start) return;
  state.restrictions.push({
    id: crypto.randomUUID(),
    personId: els.restrictionPerson.value,
    type: els.restrictionType.value,
    start,
    end,
    note: els.restrictionNote.value.trim(),
  });
  Object.keys(state.assignments).forEach((key) => {
    if (key >= start && key <= end) {
      removePersonFromDay(els.restrictionPerson.value, key);
    }
  });
  els.restrictionForm.reset();
  saveState();
  renderAll();
});

els.restrictionFilter?.addEventListener("change", (event) => {
  restrictionFilterValue = event.target.value;
  editingRestrictionId = null;
  renderRestrictions();
});

els.restrictionList.addEventListener("click", (event) => {
  const editId = event.target.dataset.editRestriction;
  if (editId) {
    editingRestrictionId = editId;
    renderRestrictions();
    return;
  }

  const cancelEditId = event.target.dataset.cancelRestrictionEdit;
  if (cancelEditId) {
    editingRestrictionId = null;
    renderRestrictions();
    return;
  }

  const saveId = event.target.dataset.saveRestriction;
  if (saveId) {
    updateRestrictionFromEditItem(saveId);
    return;
  }

  const id = event.target.dataset.removeRestriction;
  if (id) {
    if (!confirm("Remover esta restrição?")) return;
    state.restrictions = state.restrictions.filter((restriction) => restriction.id !== id);
    if (editingRestrictionId === id) editingRestrictionId = null;
    saveState();
    renderAll();
  }
});

els.holidayForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const date = els.holidayDate.value;
  const name = els.holidayName.value.trim();
  if (!date || !name) return;
  state.holidays = state.holidays.filter((holiday) => holiday.date !== date);
  state.holidays.push({
    id: crypto.randomUUID(),
    date,
    name,
  });
  els.holidayForm.reset();
  saveState();
  renderAll();
});

els.holidayList.addEventListener("click", (event) => {
  const id = event.target.dataset.removeHoliday;
  if (!id) return;
  if (!confirm("Remover este feriado?")) return;
  state.holidays = state.holidays.filter((holiday) => holiday.id !== id);
  saveState();
  renderAll();
});

renderAll();
