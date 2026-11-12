/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  headingStyle: 'atx',
  strongDelimiter: '**',
});

turndown.use(gfm);

const findClosestElement = (node: Node | null, selector: string): Element | null => {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest(selector) ?? null;
};

const getSelectionFragment = (range: Range): DocumentFragment => {
  const fragment = range.cloneContents();
  let ancestor: Node | null = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.TEXT_NODE) {
    ancestor = ancestor.parentNode;
  }

  let wrapped: Node = fragment;
  while (ancestor instanceof Element) {
    if (ancestor.matches('.markdown-shadow-body, [data-testid="message-text-content"]')) {
      break;
    }
    const wrapper = ancestor.cloneNode(false);
    wrapper.appendChild(wrapped);
    wrapped = wrapper;
    ancestor = ancestor.parentNode;
  }

  const result = document.createDocumentFragment();
  result.appendChild(wrapped);
  return result;
};

/** Convert the currently selected rendered message fragment back to GFM Markdown. */
export const selectionToMarkdown = (selection: Selection): string => {
  if (selection.isCollapsed || selection.rangeCount === 0) {
    return '';
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return '';
  }

  const range = selection.getRangeAt(0);
  const startCode = findClosestElement(selection.anchorNode, 'code');
  const endCode = findClosestElement(selection.focusNode, 'code');
  if (startCode && startCode === endCode) {
    const language = [...startCode.classList].map((className) => /^language-(.+)$/.exec(className)?.[1]).find(Boolean);
    if (language || selectedText.includes('\n')) {
      return `\`\`\`${language ?? ''}\n${selectedText}\n\`\`\``;
    }
  }

  const container = document.createElement('div');
  container.appendChild(getSelectionFragment(range));
  return turndown.turndown(container.innerHTML).trim() || selectedText;
};
