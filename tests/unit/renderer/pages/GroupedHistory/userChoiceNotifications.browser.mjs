// Run against the existing Vite dev server; only this isolated page is exercised.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const host = process.env.AIONUI_CHOICE_FIXTURE_HOST || 'http://127.0.0.1:5300';
const fixture = path
  .resolve('tests/unit/renderer/pages/GroupedHistory/userChoiceNotifications.fixture.tsx')
  .replaceAll('\\', '/');
const output = mkdtempSync(path.join(tmpdir(), 'aionui-choice-notification-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [name, width] of [
    ['desktop', 1280],
    ['tablet', 1024],
    ['phone', 390],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${host}/choice-notification-fixture.html`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.route('**/api/**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    );
    await page.goto(`${host}/choice-notification-fixture.html`);
    await page.getByRole('button', { name: '확인이 필요한 대화 2개' }).click();
    const question = page.getByRole('button', { name: /사용자 선택 필요.*선택 질문 테스트 1/ });
    await question.waitFor();
    const error = page.getByRole('button', { name: /미확인 오류.*선택 질문 테스트 1/ });
    await error.waitFor();
    assert.equal(await page.getByTestId('fixture-failures').textContent(), '1');
    await page.getByText('사용자 확인 필요', { exact: true }).waitFor();
    if (name === 'phone') assert.ok(await page.locator('.arco-drawer').count());
    else assert.ok(await page.locator('.arco-popover').count());
    for (const button of await page.getByRole('button', { name: '알림 해제' }).all()) {
      const bounds = await button.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'dismiss button must fit the viewport');
    }
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
    await error.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="fixture-failures"]')?.textContent === '0');
    assert.equal(
      await page.getByTestId('fixture-navigation').getAttribute('data-path'),
      '/conversation/conversation-a'
    );
    assert.equal(await page.getByTestId('fixture-pending').textContent(), '2');
    await page.getByRole('button', { name: '확인이 필요한 대화 2개' }).click();
    await question.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="fixture-navigation"]')?.getAttribute('data-path') ===
          '/conversation/conversation-a' &&
        document.querySelector('[data-testid="fixture-navigation"]')?.getAttribute('data-message') ===
          'message-conversation-a'
    );
    assert.equal(
      await page.getByTestId('fixture-navigation').getAttribute('data-path'),
      '/conversation/conversation-a'
    );
    assert.equal(await page.getByTestId('fixture-navigation').getAttribute('data-message'), 'message-conversation-a');
    assert.equal(await page.getByTestId('fixture-pending').textContent(), '2');
    await page.getByRole('button', { name: '확인이 필요한 대화 2개' }).click();
    await page.getByRole('button', { name: '알림 해제' }).first().click();
    await page.waitForFunction(() => document.querySelector('[data-testid="fixture-pending"]')?.textContent === '1');
    assert.equal(await page.getByTestId('fixture-pending').textContent(), '1');
    await page.reload();
    await page.getByRole('button', { name: '확인이 필요한 대화 1개' }).waitFor();
    assert.equal(await page.getByTestId('fixture-pending').textContent(), '1');
    assert.equal(await page.getByTestId('fixture-failures').textContent(), '0');
    await page.getByRole('button', { name: '확인이 필요한 대화 1개' }).click();
    await page.getByRole('button', { name: '알림 해제' }).click();
    await page.getByText('확인이 필요한 알림이 없습니다.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `${name}: mixed questions/errors, popup/sheet, read synchronization, dismissal, reload and empty text passed`
    );
    await context.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
