/* eslint-disable no-await-in-loop -- Browser assertions and module interception are sequential. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const host = process.env.AIONUI_FIXTURE_HOST || 'http://127.0.0.1:5300';
const fixture = path
  .resolve('tests/unit/renderer/pages/HistorySectionActivity/visual.fixture.tsx')
  .replaceAll('\\', '/');
const output = mkdtempSync(path.join(tmpdir(), 'aionui-section-activity-'));
const workspace = 'D:/Git/Holdem_Fork3/hdtf-client';
const conversation = (id, extra = {}) => ({ id, name: id, type: 'acp', created_at: 1, modified_at: 1, extra });
const project = conversation('project', { workspace, custom_workspace: true });
const free = conversation('free');
const sections = [
  {
    timeline: 'Today',
    items: [
      { type: 'workspace', time: 1, workspaceGroup: { workspace, display_name: workspace, conversations: [project] } },
      { type: 'conversation', time: 1, conversation: free },
    ],
  },
];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    );
    const mocks = {
      '**/src/common/index.ts*': 'export const ipcBridge = {};',
      '**/hooks/context/LayoutContext.tsx*': `export const useLayoutContext = () => ({ isMobile: ${width < 768} });`,
      '**/hooks/context/UserChoiceNotifications/index.tsx*': 'export const ProjectChoiceBadge = () => null;',
      '**/pages/cron/index.ts*': 'export const useCronJobsMap = () => ({ setActiveConversation: () => {} });',
      '**/components/base/AionModal.tsx*': 'export default () => null;',
      '**/GroupedHistory/ConversationRow.tsx*': 'export default () => null;',
      '**/GroupedHistory/components/BookmarkedConversationList.tsx*': 'export default () => null;',
      '**/GroupedHistory/components/MnpUnlinkedConversationsModal/index.tsx*': 'export default () => null;',
      '**/GroupedHistory/components/ConversationActivityFilter.tsx*': 'export default () => null;',
      '**/GroupedHistory/hooks/useProjectGitBranches.ts*': 'export const useProjectGitBranches = () => ({});',
      '**/GroupedHistory/hooks/useConversationActivityFilter.ts*':
        'export const useConversationActivityFilter = () => ({ enabled: false, filteredConversations: [] });',
      '**/GroupedHistory/hooks/useConversationActions.ts*':
        "export const useConversationActions = () => ({ renameModalVisible: false, renameModalName: '' });",
      '**/GroupedHistory/hooks/useConversations.ts*': `export const useConversations = () => ({ conversations: ${JSON.stringify([project, free])}, pinnedConversations: [], timelineSections: ${JSON.stringify(sections)}, expandedWorkspaces: [], historyView: 'all', collapsedSections: new Set(['projects', 'conversations']), isConversationGenerating: () => true, hasCompletionUnread: () => false, hasFailureUnread: () => false });`,
      '**/team/hooks/useTeamList.ts*':
        "export const useTeamList = () => ({ teams: [{ id: 'team-1', name: 'Team 1' }], mutate: () => {} });",
      '**/team/hooks/useSiderTeamBadges.ts*': 'export const useSiderTeamBadges = () => new Map();',
      '**/Sider/useSiderTeamRunning.ts*': 'export const useSiderTeamRunning = () => () => true;',
      '**/Sider/SiderItem.tsx*': 'export default () => null;',
      '**/team/components/TeamCreateModal.tsx*': 'export default () => null;',
    };
    for (const [pattern, body] of Object.entries(mocks)) {
      await page.route(pattern, (route) => route.fulfill({ contentType: 'application/javascript', body }));
    }
    await page.route(`${host}/section-activity-fixture.html`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<html data-color-scheme="default"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixture}"></script></body></html>`,
      })
    );
    await page.goto(`${host}/section-activity-fixture.html`);
    const indicators = page.locator('.sider-section-label').getByRole('img', { name: '처리 중...' });
    await indicators.nth(2).waitFor();
    assert.equal(await indicators.count(), 3);
    const dots = indicators.first().locator('span');
    assert.equal(await dots.count(), 3);
    const animation = await dots.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return { name: style.animationName, delay: style.animationDelay, duration: style.animationDuration };
      })
    );
    assert.ok(animation.every((dot) => dot.name !== 'none' && dot.duration === '1.1s'));
    assert.deepEqual(
      animation.map((dot) => dot.delay),
      ['0s', '0.14s', '0.28s']
    );
    const motion = await dots.first().evaluate(async (dot) => {
      const before = getComputedStyle(dot).transform;
      const bounds = dot.parentElement.getBoundingClientRect();
      await new Promise((resolve) => setTimeout(resolve, 220));
      const after = getComputedStyle(dot).transform;
      const nextBounds = dot.parentElement.getBoundingClientRect();
      return {
        before,
        after,
        sameBounds: bounds.x === nextBounds.x && bounds.y === nextBounds.y && bounds.width === nextBounds.width,
      };
    });
    assert.notEqual(motion.before, motion.after);
    assert.equal(motion.sameBounds, true);
    await page.screenshot({ path: path.join(output, `${width}.png`) });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(
      (await dots.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationName))).every(
        (name) => name === 'none'
      )
    );
    for (const indicator of await indicators.all()) {
      const box = await indicator.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
    }
    assert.deepEqual(errors, []);
    console.log(`${width}px: all three headers, staggered bouncing dots, stable layout and reduced motion passed`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
