// Tap-to-open blocks for the home page on phones (5 October: the page was 13.6 screens at
// 390px). On wider screens nothing folds and the markup is the same as before.
//
// Two ways to fold:
//   - "hide": the body is hidden="until-found" while closed, so it stays in the DOM and the
//     browser's find-in-page can still reach it (opening the block when it does);
//   - "clamp": the first line of the body stays visible, the rest is clipped until opened.
// The toggle is a real <button> with aria-expanded and aria-controls, so it works from the
// keyboard and is announced. Nothing is removed from the DOM in either state.
//
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useId, useRef, useState } from 'react';

const PHONE = '(max-width: 599.98px)';

/** True below 600px, the same breakpoint as the phone rules in site.css. */
export const usePhone = (): boolean => {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const m = window.matchMedia(PHONE);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
};

/**
 * The folded body. hidden="until-found" is set on the element directly: React types
 * `hidden` as a boolean, and the string form is what keeps find-in-page working.
 */
const Body: React.FC<{
  id: string;
  open: boolean;
  mode: 'hide' | 'clamp';
  onFound: () => void;
  as?: 'div' | 'p';
  className?: string;
  children: React.ReactNode;
}> = ({ id, open, mode, onFound, as = 'div', className, children }) => {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || mode !== 'hide') return;
    if (open) el.removeAttribute('hidden');
    else el.setAttribute('hidden', 'until-found');
    el.addEventListener('beforematch', onFound);
    return () => el.removeEventListener('beforematch', onFound);
  }, [open, mode, onFound]);
  const Tag = as;
  return (
    <Tag
      id={id}
      ref={ref as React.Ref<never>}
      className={`fold-body ${mode}${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </Tag>
  );
};

const Toggle: React.FC<{ open: boolean; controls: string; onClick: () => void; children: React.ReactNode }> = ({
  open,
  controls,
  onClick,
  children,
}) => (
  <button type="button" className="fold-btn" aria-expanded={open} aria-controls={controls} onClick={onClick}>
    <span>{children}</span>
    <span className="fold-i" aria-hidden="true" />
  </button>
);

/**
 * A titled paragraph (the "pt" block). On phones the title becomes the toggle.
 * On wider screens: <div class="pt"><h3>title</h3><p>body</p></div>, as before.
 */
export const FoldPoint: React.FC<{
  title: string;
  mode: 'hide' | 'clamp';
  defaultOpen?: boolean;
  wide?: boolean;
  span2?: boolean;
  children: React.ReactNode;
}> = ({ title, mode, defaultOpen = false, wide, span2, children }) => {
  const phone = usePhone();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const cls = `pt${wide ? ' wide' : ''}${span2 ? ' span2' : ''}`;
  if (!phone)
    return (
      <div className={cls}>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    );
  return (
    <div className={`${cls} fold${open ? ' is-open' : ''}`}>
      <h3>
        <Toggle open={open} controls={id} onClick={() => setOpen(!open)}>
          {title}
        </Toggle>
      </h3>
      <Body id={id} open={open} mode={mode} onFound={() => setOpen(true)} as="p">
        {children}
      </Body>
    </div>
  );
};

/**
 * A list item (or block) "<strong>lead</strong> rest". On phones the lead becomes the
 * toggle; the rest shows its first line ("clamp") or nothing ("hide") until opened.
 */
export const FoldItem: React.FC<{
  lead: string;
  mode?: 'hide' | 'clamp';
  tag?: 'li' | 'div';
  className?: string;
  children: React.ReactNode;
}> = ({ lead, mode = 'clamp', tag = 'li', className, children }) => {
  const phone = usePhone();
  const id = useId();
  const [open, setOpen] = useState(false);
  const Tag = tag;
  if (!phone)
    return (
      <Tag className={className}>
        <strong>{lead}</strong> {children}
      </Tag>
    );
  return (
    <Tag className={`${className ? `${className} ` : ''}fold${open ? ' is-open' : ''}`}>
      <Toggle open={open} controls={id} onClick={() => setOpen(!open)}>
        <strong>{lead}</strong>
      </Toggle>
      <Body id={id} open={open} mode={mode} onFound={() => setOpen(true)}>
        {children}
      </Body>
    </Tag>
  );
};

/** A group shown in full on wider screens and behind one labelled toggle on phones. */
export const FoldGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const phone = usePhone();
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!phone) return <>{children}</>;
  return (
    <div className={`fold fold-group${open ? ' is-open' : ''}`}>
      <Toggle open={open} controls={id} onClick={() => setOpen(!open)}>
        {label}
      </Toggle>
      <Body id={id} open={open} mode="hide" onFound={() => setOpen(true)} className="posts">
        {children}
      </Body>
    </div>
  );
};
