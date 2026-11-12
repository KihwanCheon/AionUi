/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { useThemeDetection } from '@/renderer/pages/conversation/Preview/hooks/useThemeDetection';
import { getFileIconName, getFolderIconName, ICON_PREFIX_DARK, ICON_PREFIX_LIGHT } from './fileIcon';
import { addCollection, Icon, type IconifyJSON } from '@iconify/react';
import { Link } from '@icon-park/react';
import React from 'react';
import catppuccinLatte from './catppuccinLatte.json';
import catppuccinMacchiato from './catppuccinMacchiato.json';

// Register both bundled catppuccin flavors once, so <Icon> resolves names
// offline without hitting the Iconify API. Intentional, isolated deviation from
// the @icon-park-only icon convention (see AGENTS.md): the file tree uses the
// catppuccin file-icon theme for a softer, uniform look. The two flavors share
// identical icon names — only the palette (and thus the prefix) differs, picked
// by the active theme so neutral icons don't wash out on a light background.
addCollection(catppuccinLatte as IconifyJSON);
addCollection(catppuccinMacchiato as IconifyJSON);

const ICON_SIZE = 16;
const BADGE_SIZE = 9;

type FileTypeIconProps = {
  node: Pick<IDirOrFile, 'name' | 'relativePath' | 'isFile'>;
  /** Whether the folder node is currently expanded (ignored for files). */
  expanded?: boolean;
  /** A symlink or Windows junction (mac symlink / windows junction alike) —
   * draws a small link badge over the base folder/file icon so it reads
   * distinctly even when it is browsable like a real directory. */
  isSymlink?: boolean;
};

/**
 * File-tree leading icon rendered with the "catppuccin" file-icon theme: a
 * colored per-type icon for files and an open/closed folder icon for directories.
 * A symlink/junction additionally gets a small link badge overlay.
 */
const FileTypeIcon: React.FC<FileTypeIconProps> = ({ node, expanded, isSymlink }) => {
  // Pick the catppuccin flavor from the active appearance (data-theme on <html>,
  // written as 'light'/'dark' by applyTheme — so custom themes resolve correctly
  // too). Reads the DOM signal rather than the theme context so the file-tree row
  // needs no ThemeProvider wrapper.
  const appearance = useThemeDetection();
  const prefix = appearance === 'dark' ? ICON_PREFIX_DARK : ICON_PREFIX_LIGHT;
  const isFolder = !node.isFile;
  const name = isFolder ? getFolderIconName(Boolean(expanded)) : getFileIconName(node);

  return (
    <span
      data-testid={isFolder ? 'file-type-icon-folder' : 'file-type-icon-file'}
      className='inline-flex items-center justify-center flex-shrink-0'
      style={{ width: ICON_SIZE, height: ICON_SIZE, lineHeight: 0, position: 'relative' }}
    >
      <Icon icon={`${prefix}:${name}`} width={ICON_SIZE} height={ICON_SIZE} />
      {isSymlink && (
        <span
          data-testid='file-type-icon-symlink-badge'
          className='inline-flex items-center justify-center text-aou-6'
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            lineHeight: 0,
            background: 'var(--color-bg-2)',
            borderRadius: '50%',
          }}
        >
          <Link theme='filled' size={BADGE_SIZE} />
        </span>
      )}
    </span>
  );
};

export default FileTypeIcon;
