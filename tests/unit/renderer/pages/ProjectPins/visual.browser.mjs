/* eslint-disable no-await-in-loop -- Browser interactions and module routes are sequential. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const host = process.env.AIONUI_FIXTURE_HOST || 'http://127.0.0.1:5300';
const fixture = path.resolve('tests/unit/renderer/pages/ProjectPins/visual.fixture.tsx').replaceAll('\\', '/');
const output = mkdtempSync(path.join(tmpdir(), 'aionui-project-pins-'));
const workspaces = ['D:/Git/AionUi/AionUi', 'D:/Git/MindNProgress/server', 'D:/Git/Holdem_Fork3/hdtf-client'];
const sections = [
  {
    timeline: 'Today',
    items: workspaces.map((workspace) => ({
      type: 'workspace',
      time: 1,
      workspaceGroup: { workspace, display_name: workspace, conversations: [] },
    })),
  },
];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    let preferences = {};
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route('**/api/**', (route) => {
      if (!route.request().url().endsWith('/api/settings/client')) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      }
      if (route.request().method() === 'PUT') preferences = { ...preferences, ...route.request().postDataJSON() };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: preferences }) });
    });
    const mocks = {
      '**/hooks/context/LayoutContext.tsx*': `export const useLayoutContext = () => ({ isMobile: ${width < 768} });`,
      '**/hooks/context/UserChoiceNotifications/index.tsx*': 'export const ProjectChoiceBadge = () => null;',
      '**/pages/cron/index.ts*': 'export const useCronJobsMap = () => ({ setActiveConversation: () => {} });',
      '**/components/base/AionModal.tsx*': 'export default () => null;',
      '**/GroupedHistory/ConversationRow.tsx*': 'export default () => null;',
      '**/GroupedHistory/components/BookmarkedConversationList.tsx*': 'export default () => null;',
      '**/GroupedHistory/components/MnpUnlinkedConversationsModal/index.tsx*': 'export default () => null;',
      '**/GroupedHistory/components/ConversationActivityFilter.tsx*': 'export default () => null;',
      '**/GroupedHistory/hooks/useProjectGitBranches.ts*': `export const useProjectGitBranches = () => (${JSON.stringify(Object.fromEntries(workspaces.map((workspace) => [workspace, 'main'])))});`,
      '**/GroupedHistory/hooks/useConversationActivityFilter.ts*':
        'export const useConversationActivityFilter = () => ({ enabled: false, filteredConversations: [] });',
      '**/GroupedHistory/hooks/useConversationActions.ts*':
        "export const useConversationActions = () => ({ renameModalVisible: false, renameModalName: '' });",
      '**/GroupedHistory/hooks/useConversations.ts*': `export const useConversations = () => ({ conversations: [], pinnedConversations: [], timelineSections: ${JSON.stringify(sections)}, expandedWorkspaces: [], historyView: 'all', collapsedSections: new Set(), isConversationGenerating: () => false, hasCompletionUnread: () => false, hasFailureUnread: () => false });`,
    };
    for (const [pattern, body] of Object.entries(mocks)) {
      await page.route(pattern, (route) => route.fulfill({ contentType: 'application/javascript', body }));
    }
    await page.route(`${host}/project-pins-fixture.html`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html data-color-scheme="default"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.goto(`${host}/project-pins-fixture.html`);
    const rows = page.locator('.workspace-collapse');
    await rows.nth(2).waitFor();
    const pinAt = async (index, label) => {
      await rows.nth(index).hover();
      await rows.nth(index).getByLabel('Project actions').click();
      await page.getByRole('menuitem', { name: label, exact: true }).click();
      await page.locator('.arco-dropdown-menu:visible').waitFor({ state: 'hidden' });
    };
    await pinAt(2, '프로젝트 고정');
    await rows.nth(0).getByText('Holdem_Fork3/hdtf-client', { exact: true }).waitFor();
    await pinAt(2, '프로젝트 고정');
    await rows.nth(1).getByText('MindNProgress/server', { exact: true }).waitFor();
    assert.deepEqual(preferences['sidebar.pinnedWorkspaces'], [workspaces[2], workspaces[1]]);
    await pinAt(0, '프로젝트 고정 해제');
    await rows.nth(0).getByText('MindNProgress/server', { exact: true }).waitFor();
    await pinAt(2, '프로젝트 고정');
    await rows.nth(1).getByText('Holdem_Fork3/hdtf-client', { exact: true }).waitFor();
    await page.reload();
    await rows.nth(0).getByText('MindNProgress/server', { exact: true }).waitFor();
    await rows.nth(1).getByText('Holdem_Fork3/hdtf-client', { exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: '고정된 프로젝트', exact: true }).count(), 2);
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, 'Project headers must fit the viewport');
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `${width}.png`), animations: 'disabled' });
    console.log(`${width}px: menu pin, unpin, repin order, persistence and layout passed`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
