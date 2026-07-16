// src/components/intake/EventForm/styles.ts
//
// Inline style tokens mirroring unified-design-system.css. Raw HTML for
// the first ship per paper §6 (no private foundation primitives).

import type { CSSProperties } from 'react';

export const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'Arial, sans-serif',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--fg, #111)',
  marginBottom: 4,
};

export const inputStyle: CSSProperties = {
  width: '100%',
  fontFamily: 'Arial, sans-serif',
  fontSize: 13,
  padding: '6px 8px',
  border: '2px solid var(--border, #111)',
  borderRadius: 0,
  background: 'var(--bg, #fff)',
  color: 'var(--fg, #111)',
  boxSizing: 'border-box',
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 90,
  resize: 'vertical',
};

export const buttonStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '8px 16px',
  border: '2px solid var(--border, #111)',
  borderRadius: 0,
  background: 'var(--fg, #111)',
  color: 'var(--bg, #fff)',
  cursor: 'pointer',
};

export const chipStyle = (on: boolean): CSSProperties => ({
  ...buttonStyle,
  background: on ? 'var(--fg, #111)' : 'var(--bg, #fff)',
  color: on ? 'var(--bg, #fff)' : 'var(--fg, #111)',
  fontSize: 9,
  padding: '4px 8px',
});

export const fieldRowStyle: CSSProperties = { marginBottom: 14 };

export const helpStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 10,
  color: '#666',
  marginTop: 3,
};

export const errStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 10,
  color: '#a00',
  marginTop: 3,
};
