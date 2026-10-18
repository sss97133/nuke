// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LegalDocument } from './LegalDocument';

const DOC = `# Privacy Policy — NUKE Platform

**Effective Date:** January 25, 2026

---

## 1. Introduction

NUKE LTD ("NUKE," "we") operates the platform at nuke.ag.

### 2.1 Information You Provide

- **Account Information:** Name, email address
- **Vehicle Data:** Photos, documents

| Right | How |
|---|---|
| Access | write to us |
`;

describe('LegalDocument', () => {
  let root: Root, container: HTMLDivElement;
  beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  const text = () => container.textContent || '';
  async function render(status: number) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(status === 200 ? DOC : '', { status })));
    await act(async () => { root.render(<MemoryRouter><LegalDocument path="/PRIVACY_POLICY.md" title="Privacy Policy" contact="privacy@nuke.ag" /></MemoryRouter>); });
    for (let i = 0; i < 40 && /^Privacy Policy$/.test(text().trim()); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
  }

  it('renders the document as a page on kit roles, not as markdown source', async () => {
    await render(200);
    expect(container.querySelector('h1')?.textContent).toBe('Privacy Policy — NUKE Platform');
    expect(container.querySelector('h1')?.className).toContain('k-entity');
    expect(container.querySelector('h2')?.className).toContain('k-entity--dense');
    expect(container.querySelector('h3')?.className).toContain('k-label');
    expect(text()).not.toMatch(/\*\*|^#|\n#|---/);
    expect(container.querySelector('strong')?.textContent).toBe('Effective Date:');
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('table th')?.textContent).toBe('Right');
    expect(container.querySelector('[style]')).toBeNull();
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('/PRIVACY_POLICY.md');
  });

  it('keeps the title and names the contact when the document cannot be loaded', async () => {
    await render(500);
    for (let i = 0; i < 40 && !/Could not load/.test(text()); i++) await act(async () => { await new Promise(r => setTimeout(r, 25)); });
    expect(container.querySelector('h1')?.textContent).toBe('Privacy Policy');
    expect(text()).toMatch(/Could not load this document\. Write to privacy@nuke\.ag\./);
    expect(container.querySelector('a[href="mailto:privacy@nuke.ag"]')).not.toBeNull();
  });
});
