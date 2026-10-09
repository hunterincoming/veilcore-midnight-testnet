// Text a record's holder typed, made safe to show on the public verify page.
//
// The verify page is what a stranger trusts. A name is the holder's own words, so it is
// shown as a plain labelled line, never as a heading, and cleaned first: a name like
// "✅ Verified by USDA" or one padded with right-to-left overrides could otherwise pose as
// the page's own verdict. Removed: control and invisible formatting characters (which
// include the bidirectional overrides and zero-width characters), emoji and pictographs,
// check marks, crosses and ballot boxes, and enclosing marks such as the keycap. Kept:
// letters, digits and ordinary punctuation in any script, and ©, ® and ™, which appear in
// variety names. The result is capped at MAX_NAME_CHARS characters.
// SPDX-License-Identifier: Apache-2.0

export const MAX_NAME_CHARS = 80;

const KEEP = new Set(['©', '®', '™']);

// \p{Cc} control, \p{Cf} format (bidi controls, zero-width), \p{Co} private use,
// \p{Me} enclosing marks, \p{Extended_Pictographic} emoji and pictographs, variation
// selectors, and check-mark-like symbols that are not pictographs: √ ✓ ✔ ✗ ✘ ☐ ☑ ☒ 🗸 🗹 🗷.
const DROP =
  /[\p{Cc}\p{Cf}\p{Co}\p{Me}\p{Extended_Pictographic}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}√☐-☒✓-✘\u{1F5F7}-\u{1F5F9}]/u;

/** The holder-typed name, cleaned and capped, or '' if nothing printable is left. */
export const displayName = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const kept = Array.from(raw.normalize('NFC').replace(/\s+/gu, ' '))
    .filter((c) => KEEP.has(c) || !DROP.test(c))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
  const chars = Array.from(kept);
  return chars.length > MAX_NAME_CHARS
    ? `${chars
        .slice(0, MAX_NAME_CHARS - 1)
        .join('')
        .trimEnd()}…`
    : kept;
};
