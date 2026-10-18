/** Terminal panel style — kept out of primitives.tsx so that file exports components only (react-refresh). */
import type { CSSProperties } from 'react';

export const panelStyle: CSSProperties = {
  border: '2px solid var(--border)',
  background: 'var(--surface)',
  padding: '12px',
};
