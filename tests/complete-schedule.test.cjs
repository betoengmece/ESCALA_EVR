const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const names = ['findAssignment', 'lastAssignmentBefore', 'nextAssignmentAfter', 'dayDistance',
  'addDaysKey', 'isWeekend', 'isBusinessWorkday', 'isRestSuspendedDay', 'hasPersonalRestrictionDay',
  'suspensionDaysBetween', 'effectiveDayDistance', 'commercialEffectiveDayDistance', 'sourceRestShift',
  'restBalanceForAssignment', 'canUsePersonOnDay', 'placePersonInShift', 'completionCandidate', 'completeCurrentSchedule'];
const code = names.map((name) => {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}).join('\n');
function setup(people, keys) {
  const state = { people: people.map(([id, shift]) => ({ id, name: id, shift })), assignments: {}, restrictions: [] };
  const shifts = ['24x72', '12x36', 'Comercial'];
  const fixed = new Set();
  const messages = [];
  const ctx = vm.createContext({ state, SHIFT_TYPES: shifts, EMPTY_SLOT_ID: 'vazio',
    REST_HOURS: { '24x72': 96, '12x36': 48, Comercial: 24 },
    getAssignments: (key) => state.assignments[key] ||= { '24x72': [], '12x36': [], Comercial: [] },
    findPerson: (id) => state.people.find((p) => p.id === id),
    isEmptySlot: (id) => id === 'vazio',
    getPersonShiftForDate: (p) => p.shift,
    getPersonShiftForDateById: (id) => state.people.find((p) => p.id === id).shift,
    isCommercialRegime: (shift) => shift.startsWith('Comercial'),
    scheduleColumnForRegime: (shift) => shift.startsWith('Comercial') ? 'Comercial' : shift,
    isUnavailableForAssignment: (id, key) => state.restrictions.some((r) => r.personId === id && key >= r.start && key <= r.end),
    isDayBeforeVacation: (id, key) => state.restrictions.some((r) => r.personId === id && r.type === 'Férias' && r.start === ctx.addDaysKey(key, 1)),
    hasFixedAssignmentInDay: () => false,
    isFixedAssignment: (key, shift, id) => fixed.has(`${key}:${shift}:${id}`),
    getPeopleInDay: (key) => shifts.flatMap((s) => ctx.getAssignments(key)[s]),
    countMonthTotalAssignments: (id, monthKeys) => monthKeys.filter((k) => ctx.getPeopleInDay(k).includes(id)).length,
    getMonthKeys: () => keys,
    getHistorical24PairCycle: () => ({ pairs: [], startIndex: 0 }),
    isHoliday: () => false,
    dateKey: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    saveState: () => {}, renderAll: () => {}, alert: (m) => messages.push(m),
  });
  vm.runInContext(code, ctx);
  return { ctx, state, fixed, messages };
}
test('previous month rest is mandatory and impossible coverage becomes empty', () => {
  const h = setup([['A', '24x72']], ['2026-06-01', '2026-06-02', '2026-06-03']);
  h.ctx.getAssignments('2026-05-30')['24x72'].push('A');
  h.ctx.completeCurrentSchedule();
  assert.equal(h.ctx.getAssignments('2026-06-01')['24x72'].join(','), 'vazio,vazio');
  assert(h.ctx.getAssignments('2026-06-03')['24x72'].includes('A'));
  assert.equal(h.ctx.restBalanceForAssignment('A', '2026-06-03'), 0);
});
test('insertion cannot cause an early return on an existing future card', () => {
  const h = setup([['A', '24x72']], ['2026-06-30']);
  h.ctx.getAssignments('2026-07-02')['24x72'].push('A');
  h.ctx.completeCurrentSchedule();
  assert(!h.ctx.getAssignments('2026-06-30')['24x72'].includes('A'));
  assert.equal(h.ctx.getAssignments('2026-07-02')['24x72'][0], 'A');
});
test('suspended restriction days cannot bypass the positive index filter', () => {
  const h = setup([['A', '24x72']], ['2026-06-06']);
  h.ctx.getAssignments('2026-06-01')['24x72'].push('A');
  h.state.restrictions.push({ personId: 'A', start: '2026-06-02', end: '2026-06-05', type: 'Férias' });
  assert.equal(h.ctx.completionCandidate(h.state.people[0], '2026-06-06', '24x72'), null);
});
test('base regimes filled at earliest legal dates, fixed commercial never becomes 24h', () => {
  const h = setup([['A', '12x36'], ['B', 'Comercial Fixo']], ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-06']);
  for (const key of h.ctx.getMonthKeys()) h.ctx.getAssignments(key)['24x72'].push('vazio', 'vazio');
  for (const key of h.ctx.getMonthKeys()) h.fixed.add(`${key}:24x72:vazio`);
  h.ctx.getAssignments('2026-05-30')['12x36'].push('A');
  h.ctx.completeCurrentSchedule();
  assert(h.ctx.getAssignments('2026-06-01')['12x36'].includes('A'));
  assert(!h.ctx.getAssignments('2026-06-02')['12x36'].includes('A'));
  assert(h.ctx.getAssignments('2026-06-03')['12x36'].includes('A'));
  assert(h.ctx.getAssignments('2026-06-02').Comercial.includes('B'));
  assert(!h.ctx.getAssignments('2026-06-06').Comercial.includes('B'));
  const before = JSON.stringify(h.state);
  h.ctx.completeCurrentSchedule();
  assert.equal(JSON.stringify(h.state), before);
});
test('restrictions and vacation eve blocked, existing conflicting cards preserved and reported', () => {
  const h = setup([['A', '24x72'], ['B', '24x72']], ['2026-06-01', '2026-06-02']);
  h.state.restrictions.push({ personId: 'A', start: '2026-06-02', end: '2026-06-10', type: 'Férias' });
  h.ctx.getAssignments('2026-06-01')['24x72'].push('B');
  h.ctx.getAssignments('2026-06-02')['24x72'].push('B');
  h.ctx.completeCurrentSchedule();
  assert.equal(h.ctx.getAssignments('2026-06-01')['24x72'].join(','), 'B,vazio');
  assert.equal(h.ctx.getAssignments('2026-06-02')['24x72'].join(','), 'B,vazio');
  assert.match(h.messages[0], /1 card\(s\) já existente/);
});
test('eligible overdue candidate preferred over someone already working regularly', () => {
  const h = setup([['A', '24x72'], ['B', '24x72']], ['2026-06-01']);
  h.ctx.getAssignments('2026-06-01')['24x72'].push('existing');
  h.ctx.getAssignments('2026-05-28')['24x72'].push('A');
  h.ctx.getAssignments('2026-05-26')['24x72'].push('B');
  h.ctx.completeCurrentSchedule();
  assert(h.ctx.getAssignments('2026-06-01')['24x72'].includes('B'));
});
