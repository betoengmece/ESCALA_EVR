const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
test('spreadsheet formulas are exported as text, with CSV escaping preserved', () => {
  const ctx = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function escapeCsvCell('), source.indexOf('function uniqueAssignedPeople(')), ctx);
  assert.equal(ctx.escapeCsvCell('=1+1'), "'=1+1");
  assert.equal(ctx.escapeCsvCell('Ana; "Maria"'), '"Ana; ""Maria"""');
  assert.equal(ctx.escapeCsvCell('Ana'), 'Ana');
});
function setup(refresh = async () => {}) {
  const alerts = [], confirmations = [];
  let downloads = 0;
  const day = { '24x72': ['a', 'b'], '12x36': [], Comercial: [] };
  const ctx = vm.createContext({
    scheduleActionBusy: false, els: { exportCsv: { disabled: false } },
    syncMeta: { observedVersion: 2, version: 2, dirty: false },
    state: { people: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }], restrictions: [] },
    SHIFT_TYPES: ['24x72', '12x36', 'Comercial'],
    monthKey: () => '2026-10', getMonthKeys: () => ['2026-10-01'],
    getAssignments: () => day, formatDate: (key) => key,
    isEmptySlot: (id) => id === 'vazio', findPerson: (id) => ctx.state.people.find((p) => p.id === id),
    countMonthTotalAssignments: (id) => Object.values(day).flat().filter((v) => v === id).length,
    cardRuleIssues: () => [], restBalanceForAssignment: () => 0,
    isBusinessWorkday: () => true, isVacationRestriction: () => false,
    refreshCloudRestrictions: refresh,
    alert: (m) => alerts.push(m), confirm: (m) => { confirmations.push(m); return true; },
    downloadValidatedMonthCsv: () => downloads++,
  });
  vm.runInContext(source.slice(source.indexOf('function csvValidationIssues('), source.indexOf('function downloadValidatedMonthCsv(')), ctx);
  return { ctx, day, alerts, confirmations, downloads: () => downloads };
}
test('valid CSV waits for refresh and ignores repeated clicks', async () => {
  let resolve;
  const h = setup(() => new Promise((r) => { resolve = r; }));
  const first = h.ctx.exportMonthCsv();
  await h.ctx.exportMonthCsv();
  assert.equal(h.downloads(), 0);
  assert.equal(h.ctx.els.exportCsv.disabled, true);
  resolve(); await first;
  assert.equal(h.downloads(), 1);
  assert.equal(h.ctx.els.exportCsv.disabled, false);
});
test('offline export fails closed and releases lock', async () => {
  const h = setup(async () => { throw new Error('Offline'); });
  await h.ctx.exportMonthCsv();
  assert.equal(h.downloads(), 0);
  assert.match(h.alerts[0], /Nenhum CSV/);
  assert.equal(h.ctx.scheduleActionBusy, false);
});
test('positive indexes, duplicates, missing people and restrictions block export', async () => {
  const h = setup();
  h.day['12x36'].push('a', 'unknown');
  h.ctx.restBalanceForAssignment = () => 1;
  h.ctx.cardRuleIssues = () => [{ category: 'restriction', message: 'Impedimento' }];
  await h.ctx.exportMonthCsv();
  assert.equal(h.downloads(), 0);
  for (const pattern of [/repetida/, /não cadastrada/, /descanso \+1/, /Impedimento/]) assert.match(h.alerts[0], pattern);
});
test('empty slots and unsent changes require explicit confirmation', async () => {
  const h = setup();
  h.day['24x72'] = ['a', 'vazio'];
  h.ctx.syncMeta.dirty = true;
  h.ctx.confirm = (m) => { h.confirmations.push(m); return false; };
  await h.ctx.exportMonthCsv();
  assert.equal(h.downloads(), 0);
  assert.match(h.confirmations[0], /não enviadas/);
  assert.match(h.confirmations[0], /vaga/);
});
test('changing month during refresh cancels export', async () => {
  const h = setup(async () => { h.ctx.monthKey = () => '2026-11'; });
  await h.ctx.exportMonthCsv();
  assert.equal(h.downloads(), 0);
  assert.match(h.alerts[0], /mês selecionado mudou/);
});
test('different remote version warns before exporting local copy', async () => {
  const h = setup();
  h.ctx.syncMeta.observedVersion = 3;
  await h.ctx.exportMonthCsv();
  assert.match(h.confirmations[0], /não foi baixada automaticamente/);
});
test('cloud download failure preserves edits made while waiting', async () => {
  let reject;
  const h = setup();
  Object.assign(h.ctx, {
    requestCloudState: () => new Promise((_, r) => { reject = r; }),
    setSyncBusy() {}, updateSyncStatus() {}, renderAll() {},
  });
  vm.runInContext(source.slice(source.indexOf('async function pullFromCloud('), source.indexOf('function closeSyncPasswordDialog(')), h.ctx);
  const pending = h.ctx.pullFromCloud();
  h.ctx.state.people[0].name = 'Edited while waiting';
  reject(new Error('Offline')); await pending;
  assert.equal(h.ctx.state.people[0].name, 'Edited while waiting');
});
