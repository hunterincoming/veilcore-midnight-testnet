// A card that opens something when clicked has to open it from the keyboard too: it
// gets a tab stop, the link role, and Enter. (Cards with a button inside keep that
// button; Enter on the button does not also open the card.)
// SPDX-License-Identifier: Apache-2.0

import type React from 'react';

export const linkCard = (open: () => void, label: string) => ({
  role: 'link',
  tabIndex: 0,
  'aria-label': label,
  onClick: open,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) open();
  },
});
