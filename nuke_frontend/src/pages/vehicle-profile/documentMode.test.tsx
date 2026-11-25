// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { setDocumentMode, settled, useDocumentMode } from './documentMode';

afterEach(() => act(() => setDocumentMode(false)));

describe('document mode', () => {
  it('tells every subscribed section when the page becomes a document, and when it stops', () => {
    const Probe = () => <span>{useDocumentMode() ? 'document' : 'screen'}</span>;
    const container = document.createElement('div');
    act(() => { createRoot(container).render(<Probe />); });
    expect(container.textContent).toBe('screen');
    act(() => setDocumentMode(true));
    expect(container.textContent).toBe('document');
    expect(document.documentElement.classList.contains('vp-document-mode')).toBe(true);
    act(() => setDocumentMode(false));
    expect(container.textContent).toBe('screen');
    expect(document.documentElement.classList.contains('vp-document-mode')).toBe(false);
  });

  it('waits until no read is in flight and no section says it is reading', async () => {
    let fetching = 1;
    const root = document.createElement('div');
    root.innerHTML = '<p data-reading="receipt">Reading receipt…</p>';
    const done = settled({ isFetching: () => fetching }, root, { tick: 5, quietTicks: 2, limit: 1000 });
    setTimeout(() => { fetching = 0; }, 20);
    setTimeout(() => { root.innerHTML = '<p>Lines</p>'; }, 40);
    expect(await done).toBe(true);
    expect(await settled({ isFetching: () => 1 }, root, { tick: 5, quietTicks: 2, limit: 30 })).toBe(false);
  });
});
