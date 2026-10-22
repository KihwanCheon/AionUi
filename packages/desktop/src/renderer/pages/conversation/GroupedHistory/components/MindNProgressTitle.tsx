/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/** Accent persisted MnP role prefixes without changing the stored title. */
const MindNProgressTitle: React.FC<{ children: React.ReactNode; disabled?: boolean }> = ({ children, disabled }) => {
  if (disabled || typeof children !== 'string') return <>{children}</>;

  const prefix = /^(\[(상위|그룹 총괄)\])(?=\s|$)/.exec(children);
  if (!prefix) return <>{children}</>;

  // Arco RGB tokens use commas; a raw color property avoids UnoCSS adding slash opacity.
  return (
    <>
      <span
        className={
          prefix[2] === '그룹 총괄'
            ? 'text-[color:color-mix(in_srgb,var(--primary)_75%,var(--text-primary))]'
            : 'text-[color:color-mix(in_srgb,var(--brand)_80%,var(--text-primary))] [html[data-theme=dark]_&]:[color:rgb(var(--purple-7))]'
        }
      >
        {prefix[1]}
      </span>
      {children.slice(prefix[1].length)}
    </>
  );
};

export default MindNProgressTitle;
