/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('node-pty macOS patch', () => {
  it('closes only the low file descriptors that were successfully opened', () => {
    const patch = readFileSync(path.join(process.cwd(), 'patches', 'node-pty@1.1.0.patch'), 'utf8');

    expect(patch).toContain('+  int low_fds[3] = {-1, -1, -1};');
    expect(patch).toContain(
      [
        '+  for (size_t i = 0; i < 3; i++) {',
        '+    if (low_fds[i] != -1) {',
        '+      close(low_fds[i]);',
        '+    }',
        '   }',
      ].join('\n')
    );
    expect(patch).not.toContain('+  for (size_t i = 0; i <= count; i++) {');
  });
});
