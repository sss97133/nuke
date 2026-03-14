import type { WidgetTheme, WidgetAccent } from './types';

/**
 * Minimal design system CSS — extracted from unified-design-system.css
 * Only the custom properties + base reset. ~2 KB.
 */
const BASE_CSS = `
:host {
  display: block;
  font-family: Arial, sans-serif;
  font-size: 10px;
  line-height: 1.4;
  color: var(--nw-text);
  box-sizing: border-box;
}

:host *, :host *::before, :host *::after {
  box-sizing: border-box;
}

/* Light theme (default) */
:host {
  --nw-bg: #f5f5f5;
  --nw-surface: #ebebeb;
  --nw-surface-hover: #e0e0e0;
  --nw-border: #bdbdbd;
  --nw-border-focus: #2a2a2a;
  --nw-text: #2a2a2a;
  --nw-text-secondary: #666666;
  --nw-text-disabled: #999999;
  --nw-accent: #2a2a2a;
  --nw-accent-dim: rgba(42, 42, 42, 0.08);
  --nw-success: #16825d;
  --nw-success-dim: rgba(22, 130, 93, 0.1);
  --nw-warning: #b05a00;
  --nw-warning-dim: rgba(176, 90, 0, 0.1);
  --nw-error: #d13438;
  --nw-error-dim: rgba(209, 52, 56, 0.1);
  --nw-info: #0ea5e9;
  --nw-font: Arial, sans-serif;
  --nw-font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  --nw-radius: 0px;
  --nw-transition: 180ms cubic-bezier(0.16, 1, 0.3, 1);
  --nw-space-1: 4px;
  --nw-space-2: 8px;
  --nw-space-3: 12px;
  --nw-space-4: 16px;
  --nw-space-5: 20px;
  --nw-space-6: 24px;
}

/* Dark theme */
:host([theme="dark"]) {
  --nw-bg: #1e1e1e;
  --nw-surface: #252526;
  --nw-surface-hover: #2d2d30;
  --nw-border: #3e3e42;
  --nw-border-focus: #cccccc;
  --nw-text: #cccccc;
  --nw-text-secondary: #858585;
  --nw-text-disabled: #656565;
  --nw-accent: #cccccc;
  --nw-accent-dim: rgba(204, 204, 204, 0.12);
  --nw-info: #38bdf8;
}

/* Racing accents */
:host([accent="gulf"]) {
  --nw-accent: #ff5f00;
  --nw-accent-dim: rgba(255, 95, 0, 0.12);
}
:host([accent="martini"]) {
  --nw-accent: #012169;
  --nw-accent-dim: rgba(1, 33, 105, 0.12);
}
:host([accent="ricard"]) {
  --nw-accent: #0033a0;
  --nw-accent-dim: rgba(0, 51, 160, 0.12);
}
:host([accent="rosso"]) {
  --nw-accent: #e4002b;
  --nw-accent-dim: rgba(228, 0, 43, 0.12);
}

/* Utility classes */
.nw-card {
  background: var(--nw-surface);
  border: 2px solid var(--nw-border);
  padding: var(--nw-space-4);
  transition: border-color var(--nw-transition);
}
.nw-card:hover {
  border-color: var(--nw-border-focus);
}
.nw-label {
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--nw-text-secondary);
  font-weight: 600;
}
.nw-value {
  font-family: var(--nw-font-mono);
  font-size: 11px;
  color: var(--nw-text);
}
.nw-badge {
  display: inline-block;
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border: 1px solid var(--nw-border);
  color: var(--nw-text-secondary);
}
.nw-badge--success {
  color: var(--nw-success);
  border-color: var(--nw-success);
  background: var(--nw-success-dim);
}
.nw-badge--warning {
  color: var(--nw-warning);
  border-color: var(--nw-warning);
  background: var(--nw-warning-dim);
}
.nw-badge--error {
  color: var(--nw-error);
  border-color: var(--nw-error);
  background: var(--nw-error-dim);
}
/* Skeleton pulse animation */
@keyframes nw-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
.nw-skeleton {
  background: var(--nw-border);
  animation: nw-pulse 1.5s ease-in-out infinite;
}
.nw-divider {
  border: none;
  border-top: 1px solid var(--nw-border);
  margin: var(--nw-space-3) 0;
}
.nw-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--nw-space-6);
  gap: var(--nw-space-2);
}
.nw-loading::before {
  content: '';
  width: 24px;
  height: 2px;
  background: var(--nw-border);
  animation: nw-pulse 1.2s ease-in-out infinite;
}
.nw-loading-text {
  color: var(--nw-text-disabled);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.nw-error {
  padding: var(--nw-space-4);
  color: var(--nw-error);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid var(--nw-error);
  background: var(--nw-error-dim);
  display: flex;
  align-items: center;
  gap: var(--nw-space-2);
}
.nw-powered {
  font-size: 8px;
  color: var(--nw-text-disabled);
  text-align: right;
  padding-top: var(--nw-space-2);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.nw-powered a {
  color: var(--nw-text-secondary);
  text-decoration: none;
}
.nw-powered a:hover {
  color: var(--nw-accent);
}

/* Inference-enabled cells */
.nw-inf {
  cursor: pointer;
  transition: background var(--nw-transition);
}
.nw-inf:hover {
  background: var(--nw-accent-dim);
}
.nw-inf--active {
  background: var(--nw-accent-dim);
}

/* Inference popup overlay */
.nw-popup {
  position: absolute;
  left: 0; right: 0;
  background: var(--nw-bg);
  border: 2px solid var(--nw-border-focus);
  padding: var(--nw-space-3);
  z-index: 100;
  opacity: 0;
  transform: translateY(-2px);
  animation: nw-popup-in 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes nw-popup-in {
  to { opacity: 1; transform: translateY(0); }
}
.nw-popup-head {
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--nw-text-disabled);
  padding-bottom: var(--nw-space-1);
  border-bottom: 1px solid var(--nw-border);
  margin-bottom: var(--nw-space-2);
}
.nw-popup-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 2px 0;
}
.nw-popup-lbl {
  font-size: 8px;
  color: var(--nw-text-secondary);
}
.nw-popup-val {
  font-family: var(--nw-font-mono);
  font-size: 8px;
  font-weight: 600;
  color: var(--nw-text);
}
.nw-popup-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
}
.nw-popup-bar-lbl {
  font-size: 8px;
  color: var(--nw-text-secondary);
  min-width: 60px;
}
.nw-popup-bar-track {
  flex: 1;
  height: 3px;
  background: var(--nw-border);
  overflow: hidden;
}
.nw-popup-bar-fill {
  height: 100%;
  background: var(--nw-accent);
}
.nw-popup-bar-val {
  font-family: var(--nw-font-mono);
  font-size: 7px;
  color: var(--nw-text-disabled);
  min-width: 30px;
  text-align: right;
}
.nw-popup-note {
  font-size: 7px;
  color: var(--nw-text-disabled);
  line-height: 1.5;
  margin-top: var(--nw-space-2);
  padding-top: var(--nw-space-2);
  border-top: 1px solid var(--nw-border);
}
.nw-sig-hot { color: var(--nw-error); }
.nw-sig-warm { color: var(--nw-warning); }
.nw-sig-cool { color: var(--nw-text-secondary); }
.nw-sig-good { color: var(--nw-success); }
`;

/**
 * Inject the base theme CSS into a Shadow DOM root.
 * Additional widget-specific CSS can be appended.
 */
export function injectTheme(shadowRoot: ShadowRoot, widgetCSS?: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  if (widgetCSS) {
    style.textContent += '\n' + widgetCSS;
  }
  shadowRoot.prepend(style);
  return style;
}

/**
 * When theme="inherit", read host page CSS variables and map them.
 */
export function applyInheritTheme(shadowRoot: ShadowRoot): void {
  const root = document.documentElement;
  const computed = getComputedStyle(root);

  const mappings: Record<string, string[]> = {
    '--nw-bg': ['--bg', '--background', '--bg-color'],
    '--nw-surface': ['--surface', '--card-bg'],
    '--nw-border': ['--border', '--border-color'],
    '--nw-text': ['--text', '--text-color', '--color-text'],
    '--nw-text-secondary': ['--text-secondary', '--text-muted'],
    '--nw-accent': ['--accent', '--primary', '--primary-color'],
  };

  const overrides: string[] = [];
  for (const [widgetVar, hostVars] of Object.entries(mappings)) {
    for (const hostVar of hostVars) {
      const value = computed.getPropertyValue(hostVar).trim();
      if (value) {
        overrides.push(`${widgetVar}: ${value};`);
        break;
      }
    }
  }

  if (overrides.length > 0) {
    const style = document.createElement('style');
    style.textContent = `:host { ${overrides.join(' ')} }`;
    shadowRoot.appendChild(style);
  }
}
