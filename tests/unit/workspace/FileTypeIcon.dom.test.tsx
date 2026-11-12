/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileTypeIcon from '@/renderer/pages/conversation/explorer/fileIcon/FileTypeIcon';

describe('FileTypeIcon', () => {
  it('renders a file icon for a file node', () => {
    render(<FileTypeIcon node={{ name: 'report.pdf', relativePath: 'report.pdf', isFile: true }} />);
    expect(screen.getByTestId('file-type-icon-file')).toBeInTheDocument();
    expect(screen.queryByTestId('file-type-icon-folder')).not.toBeInTheDocument();
  });

  it('renders a folder icon for a directory node', () => {
    render(<FileTypeIcon node={{ name: 'src', relativePath: 'src', isFile: false }} />);
    expect(screen.getByTestId('file-type-icon-folder')).toBeInTheDocument();
    expect(screen.queryByTestId('file-type-icon-file')).not.toBeInTheDocument();
  });

  it('does not render a symlink badge by default', () => {
    render(<FileTypeIcon node={{ name: 'src', relativePath: 'src', isFile: false }} />);
    expect(screen.queryByTestId('file-type-icon-symlink-badge')).not.toBeInTheDocument();
  });

  it('renders a symlink badge over the folder icon for a browsable symlink/junction', () => {
    render(<FileTypeIcon node={{ name: 'link_dir', relativePath: 'link_dir', isFile: false }} isSymlink />);
    expect(screen.getByTestId('file-type-icon-folder')).toBeInTheDocument();
    expect(screen.getByTestId('file-type-icon-symlink-badge')).toBeInTheDocument();
  });

  it('renders a symlink badge over the file icon for a non-browsable symlink', () => {
    render(<FileTypeIcon node={{ name: 'link.txt', relativePath: 'link.txt', isFile: true }} isSymlink />);
    expect(screen.getByTestId('file-type-icon-file')).toBeInTheDocument();
    expect(screen.getByTestId('file-type-icon-symlink-badge')).toBeInTheDocument();
  });
});
