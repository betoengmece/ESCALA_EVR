const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
function setup() {
  const ctx = vm.createContext({ state: { holidays: [], restrictions: [] } });
  const names = ['dateKey', 'nationalHolidayName', 'calculateNationalHolidayName', 'isHoliday', 'holidayLabelsForDay',
    'dayDistance', 'addDaysKey', 'isWeekend', 'isBusinessWorkday', 'isRestSuspendedDay', 'hasPersonalRestrictionDay',
    'suspensionDaysBetween', 'effectiveDayDistance', 'commercialEffectiveDayDistance', 'effectiveHoursBetween'];
  const functions = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert(start >= 0, name);
    return source.slice(start, source.indexOf('\nfunction ', start + 1));
  }).join('\n');
  vm.runInContext(`const nationalHolidayCache = new Map();\n${functions}`, ctx);
  ctx.isCommercialRegime = (shift) => shift.startsWith('Comercial');
  return ctx;
}
test('national holidays recur and Good Friday follows Easter', () => {
  const h = setup();
  for (const date of ['2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25', '2027-03-26']) {
    assert.equal(h.isHoliday(date), true, date);
  }
  assert.equal(h.isHoliday('2026-06-04'), false); // Corpus Christi depends on local rules.
  assert.equal(h.isHoliday('2025-12-25'), false); // Existing historical schedules are unchanged.
});
test('national and registered local holidays affect commercial workdays only', () => {
  const h = setup();
  h.state.holidays.push({ date: '2026-11-03', name: 'Feriado local' });
  assert.equal(h.isBusinessWorkday('2026-11-02'), false);
  assert.equal(h.isBusinessWorkday('2026-11-03'), false);
  assert.equal(h.isBusinessWorkday('2026-11-04'), true);
  assert.equal(h.effectiveHoursBetween('a', '2026-10-30', '2026-11-04', 'Comercial'), 24);
  assert.equal(h.effectiveHoursBetween('a', '2026-10-30', '2026-11-04', '24x72'), 120);
  assert.equal(h.effectiveHoursBetween('a', '2026-10-30', '2026-11-04', '12x36'), 120);
});
test('registered holidays are preserved and do not duplicate calendar labels', () => {
  const h = setup();
  h.state.holidays.push({ date: '2026-11-02', name: 'Finados' });
  assert.deepEqual(Array.from(h.holidayLabelsForDay('2026-11-02')), ['Feriado: Finados']);
  assert.match(h.holidayLabelsForDay('2026-11-20')[0], /Consciência Negra/);
});
