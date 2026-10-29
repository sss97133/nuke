import type { FilingState, YearState } from '../../services/accountingCloseout';

/** The paperwork state of a year's return, read from the facts register (books_year_state facts), never from prose or timestamps. */
export const FILING_WORDS: Record<FilingState, string> = {
  draft: 'Draft', prepared: 'Prepared', mail_ready: 'Mail-ready', on_hold: 'On hold', mailed: 'Mailed', filed: 'Filed',
};

export type YearFiling = {
  state: FilingState; as_of: string; form: string | null; packet_pages: number | null; packet_document_id: string | null; deadline: string | null;
  /** The fact it was read from (a record the page can cite). */
  local_id: string;
  /** fact: a filing fact (scripts/books/return_facts.py). legacy_hold: the older owner-ruling fact keyed filing-hold, read until a filing fact is recorded. */
  from: 'fact' | 'legacy_hold';
};

/** The key of the owner-ruling fact that holds a year back today (2023-FACT-filing-hold). It is read as "on hold" only while the year has no
 *  filing fact; once the state is recorded structurally this bridge never applies. It is matched on the fact's key, never on its text. */
export const LEGACY_HOLD_KEY = 'filing-hold';

/** The newest settled filing fact of the year by its as_of date; failing that, the legacy hold; failing that, nothing is recorded. */
export function filingOf(state: YearState | undefined): YearFiling | null {
  if (!state) return null;
  const facts = state.facts.filter(f => f.status === 'settled');
  const recorded = facts
    .filter(f => f.topic === 'filing' && f.filing && typeof f.filing.state === 'string')
    .sort((a, b) => b.filing!.as_of.localeCompare(a.filing!.as_of) || b.date.localeCompare(a.date) || b.local_id.localeCompare(a.local_id))[0];
  if (recorded?.filing) {
    const f = recorded.filing;
    return { state: f.state, as_of: f.as_of, form: f.form ?? null, packet_pages: f.packet_pages ?? null, packet_document_id: f.packet_document_id ?? null,
      deadline: f.deadline ?? null, local_id: recorded.local_id, from: 'fact' };
  }
  const hold = facts.find(f => f.key === LEGACY_HOLD_KEY);
  return hold ? { state: 'on_hold', as_of: hold.date, form: null, packet_pages: null, packet_document_id: null, deadline: null, local_id: hold.local_id, from: 'legacy_hold' } : null;
}

/** The state is about a stored draft that is not the newest one: it must read "recorded for an earlier draft", never as the current state. */
export function forEarlierDraft(filing: YearFiling | null, newestDraftDocumentId: string | null | undefined): boolean {
  return !!filing?.packet_document_id && !!newestDraftDocumentId && filing.packet_document_id !== newestDraftDocumentId;
}

/** "2022", "2022 and 2024", "2022, 2024 and 2025". */
export function yearsPhrase(years: string[]): string {
  const names = [...years].sort();
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
