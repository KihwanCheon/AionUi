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
  for (const [name, width, theme] of [
    ['desktop-light', 1280, 'light'],
    ['desktop-dark', 1280, 'dark'],
    ['tablet', 1024, 'dark'],
    ['phone', 390, 'dark'],
    ['trailing-light', 1280, 'light'],
    ['trailing-dark', 1280, 'dark'],
    ['structured-light', 1280, 'light'],
    ['structured-dark', 1280, 'dark'],
  ]) {
    if (process.env.AIONUI_CHOICE_FIXTURE_CASE && process.env.AIONUI_CHOICE_FIXTURE_CASE !== name) continue;
    const trailingMarker = name.startsWith('trailing-');
    const structuredQuestion = name.startsWith('structured-');
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route(`${host}/choice-notification-fixture.html*`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.route('**/api/**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    );
    await page.goto(
      `${host}/choice-notification-fixture.html?theme=${theme}&case=${trailingMarker ? 'trailing' : structuredQuestion ? 'structured' : 'normal'}`
    );
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
    if (name !== 'phone') {
      const row = page.locator('#c-conversation-a');
      const boxes = page.getByTestId('fixture-message').locator('[data-choice-marker-index]');
      await question.hover();
      await page.waitForFunction(
        () => document.querySelector('#c-conversation-a')?.dataset.notificationHighlight === 'true'
      );
      assert.equal(await boxes.nth(0).getAttribute('data-notification-highlight'), 'true');
      if (trailingMarker) {
        assert.equal(await boxes.count(), 1);
        assert.ok((await boxes.first().textContent()).includes('사용자 확인이 필요합니다. 위 내용을 확인해 주세요.'));
        assert.ok(!(await boxes.first().textContent()).includes('직접 처리'));
        assert.ok(!(await page.getByTestId('fixture-message').innerText()).includes('[[AIONUI_USER_CHOICE_REQUIRED]]'));
      } else if (structuredQuestion) {
        assert.equal(await boxes.count(), 1);
      } else {
        assert.equal(await boxes.nth(1).getAttribute('data-notification-highlight'), null);
      }
      assert.notEqual(await row.evaluate((element) => getComputedStyle(element).boxShadow), 'none');
      assert.equal(await boxes.nth(0).evaluate((element) => getComputedStyle(element).outlineStyle), 'solid');
      assert.equal(await page.getByTestId('fixture-navigation').getAttribute('data-path'), '/guid');
      await question.locator('..').getByRole('button', { name: '알림 해제' }).hover();
      assert.equal(await boxes.nth(0).getAttribute('data-notification-highlight'), 'true');
      await page.screenshot({ path: path.join(output, `${name}-highlight.png`), animations: 'disabled' });
      await page.getByRole('button', { name: /사용자 선택 필요.*선택 질문 테스트 2/ }).hover();
      await page.locator('#c-conversation-b[data-notification-highlight="true"]').waitFor();
      assert.equal(await row.getAttribute('data-notification-highlight'), null);
      assert.equal(await page.locator('#c-conversation-b').getAttribute('data-notification-highlight'), 'true');
      assert.equal(await boxes.nth(0).getAttribute('data-notification-highlight'), null);
      await page.mouse.move(0, 0);
      await page.locator('#c-conversation-b[data-notification-highlight]').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#c-conversation-b').getAttribute('data-notification-highlight'), null);
    } else {
      await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
    }
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
    const questionBox = page.getByTestId('fixture-message').locator('[data-choice-marker-index="0"]');
    await questionBox.click({ button: 'right' });
    assert.equal(await page.getByRole('menuitem', { name: '알림 해제' }).count(), 0);
    const inlineDismiss = questionBox.getByRole('button', { name: '알림 해제' });
    await inlineDismiss.waitFor();
    await questionBox.getByText('알림 켜짐').waitFor();
    const activeColors = await questionBox.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, text: style.color };
    });
    assert.equal(await page.getByTestId('fixture-pending').textContent(), '2');
    const menuBounds = await inlineDismiss.boundingBox();
    assert.ok(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width);
    await page.screenshot({ path: path.join(output, `${name}-active.png`), animations: 'disabled' });
    await inlineDismiss.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="fixture-pending"]')?.textContent === '1');
    assert.equal(await page.getByTestId('fixture-pending').textContent(), '1');
    await questionBox.click({ button: 'right' });
    assert.equal(await inlineDismiss.count(), 0);
    await questionBox.getByText('알림 해제됨').waitFor();
    if (!trailingMarker && !structuredQuestion) {
      const untouchedBox = page.getByTestId('fixture-message').locator('[data-choice-marker-index="1"]');
      assert.equal(await untouchedBox.count(), 1, 'dismissing one notification must retain other question boxes');
      assert.ok(await untouchedBox.isVisible(), 'other question content must stay visible');
    }
    const dismissedColors = await questionBox.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, text: style.color };
    });
    assert.notEqual(activeColors.background, dismissedColors.background);
    assert.notEqual(activeColors.border, dismissedColors.border);
    assert.equal(activeColors.text, dismissedColors.text);
    await page.screenshot({ path: path.join(output, `${name}-dismissed.png`), animations: 'disabled' });
    await page.reload();
    await page.getByRole('button', { name: '확인이 필요한 대화 1개' }).waitFor();
    assert.equal(await page.getByTestId('fixture-pending').textContent(), '1');
    assert.equal(await page.getByTestId('fixture-failures').textContent(), '0');
    if (trailingMarker || structuredQuestion)
      await page.getByTestId('fixture-message').getByText('알림 해제됨').waitFor();
    await page.getByRole('button', { name: '확인이 필요한 대화 1개' }).click();
    await page.getByRole('button', { name: '알림 해제' }).click();
    await page.getByText('확인이 필요한 알림이 없습니다.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `${name}: mixed questions/errors, popup/sheet, inline dismissal, status persistence and empty text passed`
    );
    await context.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
