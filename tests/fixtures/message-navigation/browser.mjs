/* eslint-disable no-await-in-loop -- Keep one browser scenario active so background tab throttling cannot alter layout timing. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';

const host = process.env.AIONUI_CHOICE_FIXTURE_HOST || 'http://127.0.0.1:5300';
const fixture = path.resolve('tests/fixtures/message-navigation/fixture.tsx').replaceAll('\\', '/');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
try {
  for (const [scenario, imageDelay] of [
    ['delayed-image', 150],
    ['delayed-image', 900],
    ['older-anchor', 0],
    ['long-message', 0],
    ['two-markers', 0],
    ['structured-older-anchor', 900],
    ['structured-long-options', 150],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    );
    await page.route('https://fixture.invalid/growth.svg', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, imageDelay));
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="gray"/></svg>',
      });
    });
    await page.route(`${host}/message-navigation.html*`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.goto(`${host}/message-navigation.html?scenario=${scenario}`);
    await page.getByRole('button', { name: '확인이 필요한 대화 1개' }).click();
    await page.getByRole('button', { name: /사용자 선택 필요.*알림 위치 검증.*검증용 승인/ }).click();
    await page.locator('#message-navigation-10').waitFor();
    // Allow browser smooth scrolling and delayed image layout to finish; no scroll API is mocked.
    await page.waitForTimeout(1800);
    const readGeometry = () =>
      page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="message-list-scroller"]');
        const row = document.getElementById('message-navigation-10');
        const shadow = row.querySelector('.markdown-shadow').shadowRoot;
        const question = [...shadow.querySelectorAll('p')].find((p) => p.textContent.includes('검증용 승인 질문'));
        const frame = scroller.getBoundingClientRect();
        const rect = question.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          viewportTop: frame.top,
          viewportBottom: Math.min(innerHeight, frame.bottom),
          scrollTop: scroller.scrollTop,
          pageScroll: scrollY,
        };
      });
    const geometry = await readGeometry();
    const visible = geometry.top >= geometry.viewportTop && geometry.bottom <= geometry.viewportBottom;
    // User scrolling must release anchoring: a subsequent layout change must
    // not force the question back into view.
    await page.getByTestId('message-list-scroller').hover();
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(200);
    const userPosition = await page.getByTestId('message-list-scroller').evaluate((el) => el.scrollTop);
    await page.getByTestId('message-list-content').evaluate((el) => {
      const filler = document.createElement('div');
      filler.style.height = '320px';
      el.prepend(filler);
    });
    await page.waitForTimeout(150);
    const released =
      Math.abs((await page.getByTestId('message-list-scroller').evaluate((el) => el.scrollTop)) - userPosition) < 2;

    await page.getByRole('button', { name: '확인이 필요한 대화 1개' }).click();
    await page.getByRole('button', { name: /사용자 선택 필요.*알림 위치 검증.*검증용 승인/ }).click();
    await page.waitForTimeout(150);
    const repeated = await readGeometry();
    const repeatedVisible = repeated.top >= repeated.viewportTop && repeated.bottom <= repeated.viewportBottom;

    // A real new user message restores normal follow-to-bottom behavior.
    await page.getByRole('button', { name: '사용자 메시지 추가', exact: true }).click();
    await page.waitForTimeout(200);
    const resumed = await page
      .getByTestId('message-list-scroller')
      .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 2);
    // Replying and finishing navigation must leave the question pending.
    await page.getByRole('button', { name: '확인이 필요한 대화 1개' }).waitFor();
    results.push({ scenario, imageDelay, visible, released, repeatedVisible, resumed, geometry, errors });
    console.log(JSON.stringify(results.at(-1)));
    await context.close();
  }
  assert.ok(
    results.every(
      (result) =>
        result.visible &&
        result.released &&
        result.repeatedVisible &&
        result.resumed &&
        result.geometry.pageScroll === 0 &&
        result.errors.length === 0
    ),
    'Every notification must reveal its question, respect user scrolling, and resume normal behavior'
  );
} finally {
  await browser.close();
}
