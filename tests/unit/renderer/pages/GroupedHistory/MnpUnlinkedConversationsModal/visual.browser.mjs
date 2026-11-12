// Uses an existing Vite server and an isolated fixture; no live API is reached.
/* eslint-disable no-await-in-loop -- Each viewport follows sequential browser interactions. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const host = process.env.AIONUI_FIXTURE_HOST || 'http://127.0.0.1:5300';
const fixture = path
  .resolve('tests/unit/renderer/pages/GroupedHistory/MnpUnlinkedConversationsModal/visual.fixture.tsx')
  .replaceAll('\\', '/');
const output = mkdtempSync(path.join(tmpdir(), 'aionui-mnp-unlinked-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/hooks/context/ThemeContext.tsx*', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: 'export const useThemeContext = () => ({ fontScale: 1 });',
      })
    );
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    );
    await page.route(`${host}/mnp-unlinked-fixture.html`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html data-color-scheme="default"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.goto(`${host}/mnp-unlinked-fixture.html`);
    await page.getByText('전체 선택 (7개)', { exact: true }).waitFor();
    const dialog = page.locator('.arco-modal');
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'dialog must fit viewport');
    const content = await page.locator('.aionui-modal-wrapper').boundingBox();
    assert.ok(content && content.y >= 0 && content.y + content.height <= 800, 'content and footer must fit viewport');
    for (const button of await dialog.getByRole('button').all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, 'button must fit viewport');
    }
    await page.screenshot({ path: path.join(output, `${width}.png`), animations: 'disabled' });
    await page.getByText('전체 선택 (7개)', { exact: true }).click();
    await page.getByRole('button', { name: '선택한 7개 보관' }).click();
    await page.getByText('보관 실패', { exact: true }).waitFor();
    assert.equal(await dialog.locator('li').count(), 1);
    assert.ok(await page.getByRole('checkbox', { name: '프로젝트 검토 대화 2 선택' }).isChecked());
    assert.deepEqual(errors, []);
    console.log(`${width}px: layout, bulk archive and partial failure passed`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
