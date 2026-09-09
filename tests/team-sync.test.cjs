const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const code = fs.readFileSync(require('node:path').join(__dirname, '../google-apps-script.js'), 'utf8');
const vacation = (id, personId = 'a', extra = {}) => ({ id, personId, type: 'Férias', start: '2026-10-05', end: '2026-10-14', vacationPeriod: 1, vacationYear: 2026, note: '', ...extra });
function harness(initial = []) {
  let records = structuredClone(initial), version = 4, held = false;
  const writes = [];
  const context = vm.createContext({ Date, Map, Set, JSON, Number, String, Boolean, Error, Array, Object,
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(held, false); held = true; }, releaseLock() { held = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, s) => crypto.createHash('sha256').update(s).digest(), base64EncodeWebSafe: (v) => Buffer.from(v).toString('base64url') },
  });
  vm.runInContext(code, context);
  context.ensureAllSheets = () => {};
  context.jsonResponse = (v) => v;
  context.readPeople = () => [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }];
  context.readRestrictions = () => structuredClone(records);
  context.readMeta = () => ({ version });
  context.writeMeta = (v) => { assert(held); version = Number(v.version); };
  context.appendHistory = () => {};
  context.replaceSheetRows = (name, headers, rows) => {
    assert(held); writes.push(name);
    records = rows.map(([id, personId, type, start, end, note, vacationPeriod, vacationYear]) => ({ id, personId, type, start, end, note, vacationPeriod, vacationYear }));
  };
  context.writeNormalizedState = (state) => { assert(held); records = structuredClone(state.restrictions); writes.push('full-state'); return {}; };
  return { context, writes, records: () => records, version: () => version };
}
test('independent submissions preserve both people and touch only restrictions', () => {
  const h = harness();
  for (const id of ['a', 'b']) assert.equal(h.context.saveTeamVacation({ ...vacation(id, id), action: 'vacation-save' }).ok, true);
  assert.equal(h.records().length, 2);
  assert.equal(h.version(), 6);
  assert.deepEqual(h.writes, ['restrictions', 'restrictions']);
});
test('stale edit is rejected, different people can still save', () => {
  const h = harness([vacation('first')]);
  const revision = h.context.vacationRevision(h.records()[0]);
  assert.equal(h.context.saveTeamVacation({ ...vacation('first', 'a', { end: '2026-10-15' }), revision, action: 'vacation-save' }).ok, true);
  assert.equal(h.context.saveTeamVacation({ ...vacation('first'), revision, action: 'vacation-save' }).ok, false);
  assert.equal(h.records()[0].end, '2026-10-15');
});
test('cannot edit another person or turn a course into a vacation', () => {
  const h = harness([vacation('first'), vacation('course', 'a', { type: 'Curso' })]);
  assert.equal(h.context.saveTeamVacation({ ...vacation('first', 'b'), action: 'vacation-save' }).ok, false);
  assert.equal(h.context.saveTeamVacation({ ...vacation('course'), action: 'vacation-save' }).ok, false);
  assert.equal(h.writes.length, 0);
});
test('vacation limits, overlap and first-period weekday enforced on server', () => {
  const h = harness();
  const invalid = [
    { start: '2026-10-02', end: '2026-10-04' },
    { start: '2026-10-05', end: '2026-11-05' },
    { start: '2026-02-30', end: '2026-03-05' },
    { vacationPeriod: 4 }, { vacationYear: 0 },
  ];
  for (const extra of invalid) assert.throws(() => h.context.validateTeamVacation(vacation('new', 'a', extra), []));
  assert.throws(() => h.context.validateTeamVacation(vacation('new', 'a', { vacationYear: 2027 }), [vacation('old')]));
  assert.doesNotThrow(() => h.context.validateTeamVacation(vacation('new', 'a', { vacationPeriod: 2, start: '2026-10-02', end: '2026-10-04' }), []));
  const previous = [vacation('one'), vacation('two', 'a', { vacationPeriod: 2, start: '2026-11-01', end: '2026-11-10' })];
  assert.throws(() => h.context.validateTeamVacation(vacation('three', 'a', { vacationPeriod: 3, start: '2026-12-01', end: '2026-12-09' }), previous));
  assert.doesNotThrow(() => h.context.validateTeamVacation(vacation('three', 'a', { vacationPeriod: 3, start: '2026-12-01', end: '2026-12-10' }), previous));
});
test('administrative merge preserves additions and deletions from team', () => {
  const h = harness(); const base = [vacation('old')];
  assert.equal(h.context.mergeRestrictions(base, base, [vacation('new', 'b')])[0].id, 'new');
  const merged = h.context.mergeRestrictions(base, [vacation('old', 'a', { note: 'admin' })], [...base, vacation('new', 'b')]);
  assert.equal(merged.length, 2); assert.equal(merged[0].note, 'admin');
  assert.throws(() => h.context.mergeRestrictions(base, [], [vacation('old', 'a', { end: '2026-10-15' })]));
});
test('forced old administrative save without baseline cannot erase team data', () => {
  const h = harness([vacation('new')]);
  const result = h.context.saveState({ state: { restrictions: [] }, version: 1, force: true });
  assert.equal(result.ok, false); assert.equal(h.writes.length, 0);
});
test('forced administrative save merges baseline and keeps new team vacation', () => {
  const h = harness([vacation('new')]);
  const result = h.context.saveState({ state: { restrictions: [] }, baseRestrictions: [], version: 1, force: true });
  assert.equal(result.ok, true); assert.equal(h.records()[0].id, 'new');
});
test('administrative endpoint requires password on the server', () => {
  const h = harness();
  assert.equal(h.context.doPost({ postData: { contents: JSON.stringify({ action: 'save', state: {} }) } }).ok, false);
});

test('administrative client incorporates team additions and retains its reference for the next upload', async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
  const original = vacation('old'); const addition = vacation('team', 'b');
  const state = { people: [], assignments: {}, fixedAssignments: {}, holidays: [], restrictions: [original] };
  const cloud = { ...structuredClone(state), restrictions: [original, addition] };
  const context = vm.createContext({
    state, syncMeta: { version: 4, baseRestrictions: [original], dirty: true },
    SYNC_ENDPOINT: 'mock', SYNC_PASSWORD: 'password', SHIFT_TYPES: ['24x72', '12x36', 'Comercial'],
    structuredClone, location: { href: 'test' }, Date, Map, Set, JSON, Number, String,
    fetch: async (_, options) => { const sent = JSON.parse(options.body); assert.equal(sent.password, 'password'); assert.equal(sent.baseRestrictions.length, 1); return { ok: true }; },
    readCloudJson: async () => ({ ok: true, version: 5, restrictions: cloud.restrictions }),
    requestCloudState: async () => ({ ok: true, version: 5, state: cloud }),
    isVacationRestriction: (r) => r.type === 'Férias', vacationPeriodNumber: (r) => r?.vacationPeriod || null, vacationCompetenceYear: (r) => r?.vacationYear || null,
    setSyncBusy() {}, updateSyncStatus() {}, persistSyncMeta() {}, saveState() {}, renderAll() {}, setTimeout() {},
    alert(message) { throw new Error(message); },
  });
  vm.runInContext(source.slice(source.indexOf('function vacationMetadataMismatches('), source.indexOf('async function pullFromCloud(')), context);
  vm.runInContext(source.slice(source.indexOf('async function pushToCloud('), source.indexOf('function restoreLegacyCsvData(')), context);
  await context.pushToCloud(false, true);
  assert.equal(context.state.restrictions.length, 2);
  assert.equal(context.syncMeta.baseRestrictions.length, 2);
  assert.equal(context.syncMeta.dirty, false);
});
