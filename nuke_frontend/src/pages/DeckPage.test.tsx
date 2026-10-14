// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.user, session: null, loading: false }) }));
vi.mock('../components/deck/useDeckData', () => ({
  useDeckData: () => ({
    slides: [{ id: 'slide-1', deck_id: 'synthetic-deck', slide_index: 0, slide_type: 'title', bg_type: 'light', content: {}, entity_slugs: [] }],
    orgs: {}, loading: false, error: null, refetch: () => {},
  }),
}));
vi.mock('../components/deck/DeckSlide', () => ({ default: ({ canEdit }: { canEdit: boolean }) => <div>slide editable={String(canEdit)}</div> }));
vi.mock('../components/deck/SlideEditor', () => ({ default: () => <div>slide editor</div> }));
vi.mock('../lib/supabase', () => ({ supabase: { from() {
  const query: any = { select: () => query, eq: () => query, single: () => Promise.resolve({ data: null, error: null }) };
  return query;
} } }));
vi.mock('../styles/deck-style-guide.css', () => ({}));
import DeckPage from './DeckPage';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  fixture.user = null;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
async function open() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/deck/synthetic-deck']}>
      <Routes><Route path="/deck/:deckId" element={<DeckPage />} /></Routes>
    </MemoryRouter>,
  ));
}

describe('DeckPage: only a signed-in editor edits', () => {
  it('a visitor reads the deck with no editing controls', async () => {
    await open();
    expect(container.textContent).toContain('slide editable=false');
    expect(container.textContent).not.toContain('Editing as');
    await act(async () => (container.querySelector('.deck-root > div') as HTMLElement).click());
    expect(container.textContent).not.toContain('slide editor');
  });

  it('a signed-in editor gets the toolbar and the slide editor', async () => {
    fixture.user = { id: 'user-1', email: 'editor@example.com' };
    await open();
    expect(container.textContent).toContain('Editing as editor');
    expect(container.textContent).toContain('slide editable=true');
    await act(async () => (container.querySelector('.deck-root > div') as HTMLElement).click());
    expect(container.textContent).toContain('slide editor');
  });
});
