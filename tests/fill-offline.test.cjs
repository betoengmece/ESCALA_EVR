const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const code = source.slice(source.indexOf('let scheduleActionBusy ='), source.indexOf('async function pushToCloud('));
function setup(refresh) {
  const label = { textContent: '' };
  const buttons = [{ disabled: false }, { disabled: false }, { disabled: false }];
  const errors = [];
  const ctx = vm.createContext({ refreshCloudRestrictions: refresh, document: { getElementById: () => label }, els: { autoFill: buttons[0], validateSchedule: buttons[1], completeSchedule: buttons[2] }, alert: (message) => errors.push(message) });
  vm.runInContext(code, ctx);
  return { ctx, label, buttons, errors };
}
test('failed cloud refresh still executes locally and displays stale-data warning', async () => {
  const h = setup(async () => { throw new Error('Offline'); }); let calls = 0;
  await h.ctx.withCurrentRestrictions(() => { calls++; });
  assert.equal(calls, 1); assert.match(h.label.textContent, /restrições salvas neste aparelho/);
  assert(h.buttons.every((b) => !b.disabled)); assert.equal(h.errors.length, 0);
});
test('successful refresh precedes action and duplicate clicks do not fill twice', async () => {
  let resolve; const h = setup(() => new Promise((r) => { resolve = r; })); let calls = 0;
  const first = h.ctx.withCurrentRestrictions(() => calls++);
  await h.ctx.withCurrentRestrictions(() => calls++);
  assert.equal(calls, 0); assert(h.buttons.every((b) => b.disabled));
  resolve(); await first; assert.equal(calls, 1);
});
test('algorithm errors are distinguished from sync errors and release buttons', async () => {
  const h = setup(async () => {});
  await h.ctx.withCurrentRestrictions(() => { throw new Error('Algorithm failure'); });
  assert.match(h.errors[0], /Algorithm failure/); assert(h.buttons.every((b) => !b.disabled));
});
