/* eslint-disable no-await-in-loop -- Browser actions and sequential viewport checks. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const host = process.env.AIONUI_FIXTURE_HOST || 'http://127.0.0.1:5300';
const fixture = path
  .resolve('tests/unit/renderer/pages/settings/archive-retention/visual.fixture.tsx')
  .replaceAll('\\', '/');
const output = mkdtempSync(path.join(tmpdir(), 'aionui-archive-retention-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    );
    await page.route('**/src/common/index.ts*', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `const data = { settings: { enabled: false, retention_days: 30, run_at: '04:30', timezone: 'Asia/Seoul' }, next_run_at: null, last_run_at: null, last_deleted: 0, last_failed: 0 };
        window.retentionSaves = [];
        export const ipcBridge = { sidebar: { getArchiveRetention: { invoke: async () => data }, saveArchiveRetention: { invoke: async (settings) => { window.retentionSaves.push(settings); return { ...data, settings }; } } } };`,
      })
    );
    await page.route(`${host}/archive-retention-fixture.html`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html data-color-scheme="default"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.goto(`${host}/archive-retention-fixture.html`);
    await page.getByRole('button', { name: 'Batch Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('switch').waitFor();
    await dialog.getByRole('switch').click();
    await dialog.getByRole('spinbutton').fill('7');
    const time = dialog.locator('.arco-picker input');
    await time.fill('05:45');
    await time.press('Enter');
    await dialog.getByText('시간대: Asia/Seoul').click();
    await page.locator('.arco-timepicker-container').waitFor({ state: 'hidden' });
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844);
    await page.screenshot({ path: path.join(output, `${width}.png`) });
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.retentionSaves), [
      {
        enabled: true,
        retention_days: 7,
        run_at: '05:45',
        timezone: 'Asia/Seoul',
      },
    ]);
    assert.deepEqual(errors, []);
    console.log(`${width}px: modal bounds and enabled/day/time save passed`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
