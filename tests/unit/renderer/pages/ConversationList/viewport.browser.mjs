// Run against the existing Vite server. All API calls are intercepted.
/* eslint-disable no-await-in-loop -- Exercise desktop and mobile sequentially to avoid CPU contention. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const host = 'http://127.0.0.1:5300';
const fixture = path.resolve('tests/unit/renderer/pages/ConversationList/visual.fixture.tsx').replaceAll('\\', '/');
const output = mkdtempSync(path.join(tmpdir(), 'aionui-sidebar-viewport-'));
const results = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    await context.addInitScript(() => {
      window.electronAPI = {
        emit() {},
        on() {
          return () => {};
        },
        platform: 'win32',
      };
      // Fixtures never connect to live conversation event streams.
      window.WebSocket = class {
        static OPEN = 1;
        readyState = 0;
        addEventListener() {}
        removeEventListener() {}
        send() {}
        close() {}
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route(`${host}/sidebar-viewport-fixture.html`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.route('**/api/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: new URL(route.request().url()).pathname.startsWith('/api/config') ? {} : [],
        }),
      })
    );
    await page.goto(`${host}/sidebar-viewport-fixture.html`);
    await page
      .locator('#c-row-0')
      .waitFor({ timeout: 20000 })
      .catch(async (error) => {
        console.error(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0, 1000) }));
        throw error;
      });
    const sidebar = page.getByTestId('sidebar');
    const initialRows = await sidebar.locator('.conversation-item').count();
    assert.ok(initialRows > 0 && initialRows < 50, `bounded initial rows: ${initialRows}`);
    const initialHeight = await sidebar.evaluate((element) => element.scrollHeight);
    assert.ok(initialHeight > 28000, `full scroll height: ${initialHeight}`);

    // Reach an initially unmounted conversation through real route navigation.
    await page.getByTestId('reveal-target').click();
    await page.locator('#c-row-800').waitFor();
    const target = await page.locator('#c-row-800').boundingBox();
    assert.ok(target.y >= 28 && target.y + target.height <= 800, 'target must be inside the viewport');
    assert.equal(await page.getByTestId('navigation').textContent(), 'row-800');

    const retainedScroll = await sidebar.evaluate((element) => element.scrollTop);
    await page.getByTestId('toggle-sidebar').click();
    await page.getByTestId('toggle-sidebar').click();
    assert.equal(await sidebar.evaluate((element) => element.scrollTop), retainedScroll);
    await page.getByTestId('typing').fill('스크롤 후 입력 확인');
    assert.equal(await page.getByTestId('typing').inputValue(), '스크롤 후 입력 확인');

    // Period filtering remains ahead of virtualization.
    await sidebar.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByText('업데이트 필터', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="sidebar"]').scrollHeight < 6000);
    assert.ok((await sidebar.locator('.conversation-item').count()) < 50);
    await sidebar.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.locator('#c-row-119').waitFor();
    assert.equal(await page.locator('#c-row-120').count(), 0);

    await sidebar.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByText('업데이트 필터', { exact: true }).click();
    await page.getByTestId('conversation-history-tab-bookmarks').click();
    await page.locator('#c-row-800').waitFor();
    await sidebar.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.locator('#c-row-0').waitFor();
    const bookmarkRows = await sidebar.locator('.conversation-item').count();
    assert.ok(bookmarkRows < 50, `bounded bookmark rows: ${bookmarkRows}`);

    if (width > 600) {
      const handle = page.getByTestId('conversation-drag-handle-row-0');
      const start = await handle.boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(start.x + start.width / 2, start.y + 45, { steps: 5 });
      // Move the viewport far enough that the source would normally unmount.
      await sidebar.evaluate((element) => {
        element.scrollTop = 3400;
      });
      await page.locator('#c-row-105').waitFor();
      const destination = await page.locator('#c-row-105').boundingBox();
      await page.mouse.move(start.x + start.width / 2, destination.y + 17, { steps: 8 });
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#c-row-0').count(), 1, 'active drag must remain mounted');
      assert.ok((await sidebar.locator('.conversation-item').count()) < 50);
      await page.mouse.up();
      await page.waitForFunction(() => document.documentElement.dataset.updatedConversation === 'row-0');
      const order = await page.evaluate(() => Number(document.documentElement.dataset.updatedSortOrder));
      assert.ok(order > 90000 && order < 120000, `reorder must target the scrolled range: ${order}`);
    }

    // Folding must release rows without preventing expansion and navigation.
    await sidebar.evaluate((element) => {
      element.scrollTop = 0;
    });
    const header = page.getByText('work/ProjectA', { exact: true });
    await header.click();
    await page.waitForFunction(() => !document.querySelector('#c-row-1'));
    await header.click();
    await page.locator('#c-row-1').waitFor();
    await page.getByTestId('toggle-batch').click();
    await sidebar.locator('.conversation-item').first().click();
    await page.getByText('1 selected', { exact: true }).waitFor();

    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `${width}.png`) });
    results.push({ width, initialRows, initialHeight, bookmarkRows, retainedScroll, errors });
    await context.close();
  }
  writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, results }, null, 2));
} finally {
  await browser.close();
}
