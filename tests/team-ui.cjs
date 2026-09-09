const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1);
  if (!['ferias.html', 'ferias.js', 'ferias.css'].includes(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(fs.readFileSync(path.join(root, name)));
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const data = { ok: true, people: [{ id: 'a', name: 'ANDRADE' }, { id: 'b', name: 'BOAVENTURA' }], vacations: [{ id: 'b-vac', personId: 'b', start: '2026-10-05', end: '2026-10-14', vacationYear: 2026, vacationPeriod: 1, revision: 'b1' }] };
      const posts = []; let reject = false;
      await page.route('https://script.google.com/**', async (route) => {
        const request = route.request();
        if (request.method() === 'POST') {
          const payload = request.postDataJSON(); posts.push(payload);
          if (reject) { await route.fulfill({ json: { ok: false, error: 'Estas férias foram alteradas em outra tela.' } }); return; }
          if (payload.action === 'vacation-delete') data.vacations = data.vacations.filter((r) => r.id !== payload.id);
          else {
            const entry = { ...payload, revision: 'next' };
            data.vacations = [...data.vacations.filter((r) => r.id !== payload.id), entry];
          }
        }
        await route.fulfill({ json: data });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/ferias.html`);
      await page.getByRole('button', { name: 'ANDRADE', exact: false }).click();
      await page.locator('#month').fill('2026-10'); await page.locator('#month').dispatchEvent('change');
      await page.locator('#year').fill('2026'); await page.locator('#year').dispatchEvent('change');
      await page.locator('#start').fill('2026-10-05'); await page.locator('#end').fill('2026-10-14');
      await page.getByRole('button', { name: 'Salvar minhas férias' }).click();
      await page.locator('#status.success').waitFor();
      assert.equal(await page.locator('#vacations article').count(), 1);
      assert.equal(posts[0].personId, 'a'); assert.equal(posts[0].vacationYear, 2026);
      assert.match(await page.locator('#balance').innerText(), /10\/30/);
      assert.equal(await page.locator('.count').filter({ hasText: '2 já escolheram essa data' }).count(), 10);
      await page.getByRole('button', { name: 'Editar', exact: true }).click();
      await page.locator('#year').fill('2027'); await page.locator('#year').dispatchEvent('change');
      assert.equal(await page.locator('#start').inputValue(), '2026-10-05');
      await page.locator('#year').fill('2026'); await page.locator('#year').dispatchEvent('change');
      reject = true;
      await page.locator('#end').fill('2026-10-15');
      await page.getByRole('button', { name: 'Salvar minhas férias' }).click();
      await page.locator('#status.error').waitFor();
      assert.equal(await page.locator('#end').inputValue(), '2026-10-15');
      reject = false; await page.getByRole('button', { name: 'Cancelar edição' }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/evr-team-${viewport.width}.png`, fullPage: true });
      page.on('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Excluir', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('status').textContent === 'Período excluído.');
      assert.equal(data.vacations.length, 1); assert.equal(data.vacations[0].personId, 'b');
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`UI ${viewport.width}px: seleção, criação, edição, conflito, exclusão e largura verificados`);
    }
  } finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
