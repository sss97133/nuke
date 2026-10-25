import { useEffect, useState } from 'react';

/** Only the loaded rows establish the result count for these scoped feeds. */
export function MarketResultsBar({ count, unavailable, hasMore, isLoading, searchText, onSearchChange, hasActiveFilters, onResetFilters }: {
  count: number;
  unavailable: boolean;
  hasMore: boolean;
  isLoading: boolean;
  searchText: string;
  onSearchChange: (value: string) => void;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}) {
  // URL updates are debounced; keep typing responsive between those updates.
  const [draft, setDraft] = useState(searchText);
  useEffect(() => { setDraft(searchText); }, [searchText]);
  return <div className="market-results-bar">
    <p>{isLoading ? 'Loading vehicle results…' : unavailable ? 'Result count unavailable' : `${count.toLocaleString()} vehicle ${count === 1 ? 'record' : 'records'} loaded${hasMore ? ' · more available' : ''}`}</p>
    <label>Search vehicles
      <input type="search" value={draft} onChange={event => { setDraft(event.target.value); onSearchChange(event.target.value); }} placeholder="Make, model, year…" />
    </label>
    {hasActiveFilters && <button className="button button-secondary" onClick={onResetFilters}>Clear filters</button>}
  </div>;
}
