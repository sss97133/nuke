import { useState } from 'react';

const owners = ['source_registry', 'scrape_sources', 'listing_feeds', 'forum_sources'] as const;
type Owner = typeof owners[number];
type OperatingState = 'inactive' | 'configuration_unknown' | 'cadence_missing' | 'never_reported'
  | 'overdue' | 'recent_activity' | 'invalid_clock';
type SourceRow = { id: string; label: string; enabled: boolean | null; cadence_minutes: number | null;
  last_activity_at: string | null; activity_basis: string; has_error: boolean | null; state: OperatingState };
type Inventory = { owner: Owner; unit: string; status: 'measured'; measured_at: string; complete: boolean;
  row_limit: 1000; rows: SourceRow[] };
export type SourceOperatingReading = { inventories: Partial<Record<Owner, Inventory>>; unavailable: Owner[] };

const definitions = {
  source_registry: { title: 'Platforms', unit: 'platforms', basis: 'last_successful_at',
    explanation: 'The last-success marker mixes registry synchronization and source monitoring. It does not establish completed capture.' },
  scrape_sources: { title: 'Scrape targets', unit: 'scrape targets', basis: 'last_scraped_at',
    explanation: 'The scrape marker can come from an individual listing. It does not establish a complete target check.' },
  listing_feeds: { title: 'Feed targets', unit: 'feed targets', basis: 'last_polled_at',
    explanation: 'The poll marker is recorded before work starts. Recent activity is an attempt marker, not completed capture or landed output.' },
  forum_sources: { title: 'Forums', unit: 'forums', basis: 'last_crawled_at',
    explanation: 'The crawl marker records activity. Enabled state and cadence are not defined by this owner, so reporting configuration is unknown.' },
} as const;
const stateLabels: Record<OperatingState, string> = { inactive: 'Inactive', configuration_unknown: 'Configuration unknown',
  cadence_missing: 'Cadence missing', never_reported: 'Never reported', overdue: 'Overdue',
  recent_activity: 'Recent activity', invalid_clock: 'Invalid clock' };
const states = Object.keys(stateLabels) as OperatingState[];
const at = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableBoolean = (value: unknown) => value === null || typeof value === 'boolean';
const stamp = (value: string | null) => value === null ? 'No marker recorded' : new Date(value).toLocaleString();
const count = (value: number) => value.toLocaleString();

// Validate the partition against the reading's clock, not the browser's later clock.
function expectedState(row: SourceRow, measuredAt: string): OperatingState {
  if (row.enabled === false) return 'inactive';
  if (row.enabled === null) return 'configuration_unknown';
  if (row.last_activity_at !== null && Date.parse(row.last_activity_at) > Date.parse(measuredAt)) return 'invalid_clock';
  if (row.cadence_minutes === null || row.cadence_minutes <= 0) return 'cadence_missing';
  if (row.last_activity_at === null) return 'never_reported';
  return Date.parse(measuredAt) - Date.parse(row.last_activity_at) >= row.cadence_minutes * 60_000 ? 'overdue' : 'recent_activity';
}

function validInventory(value: unknown, owner: Owner): value is Inventory {
  const inventory = value as Inventory;
  return inventory?.owner === owner && inventory.unit === definitions[owner].unit && inventory.status === 'measured'
    && at(inventory.measured_at) && inventory.row_limit === 1000 && typeof inventory.complete === 'boolean'
    && Array.isArray(inventory.rows) && inventory.rows.length <= 1000
    && (inventory.complete || inventory.rows.length === 1000)
    && new Set(inventory.rows.map(row => row?.id)).size === inventory.rows.length
    && inventory.rows.every(row => row && typeof row.id === 'string' && row.id.length > 0 && typeof row.label === 'string'
      && nullableBoolean(row.enabled) && nullableBoolean(row.has_error)
      && (row.cadence_minutes === null || typeof row.cadence_minutes === 'number' && Number.isFinite(row.cadence_minutes))
      && (row.last_activity_at === null || at(row.last_activity_at))
      && row.activity_basis === definitions[owner].basis && row.state === expectedState(row, inventory.measured_at)
      && (owner !== 'forum_sources' || row.enabled === null && row.cadence_minutes === null));
}

// A malformed owner cannot suppress the other independently measured inventories.
export function readSourceOperating(data: unknown): SourceOperatingReading | null {
  const reading = data as { contract?: unknown; section?: unknown; inventories?: { owner?: unknown }[] };
  if (reading?.contract !== 'intake_status_v1' || reading.section !== 'reporting'
    || !Array.isArray(reading.inventories) || reading.inventories.length !== owners.length
    || owners.some(owner => reading.inventories!.filter(inventory => inventory?.owner === owner).length !== 1)) return null;
  const inventories: SourceOperatingReading['inventories'] = {};
  const unavailable: Owner[] = [];
  for (const owner of owners) {
    const inventory = reading.inventories.find(value => value?.owner === owner);
    if (validInventory(inventory, owner)) inventories[owner] = inventory;
    else unavailable.push(owner);
  }
  return { inventories, unavailable };
}

export function retainSourceOperating(previous: SourceOperatingReading | null, next: SourceOperatingReading): SourceOperatingReading {
  return { inventories: { ...previous?.inventories, ...next.inventories }, unavailable: next.unavailable };
}

function InventoryDetails({ inventory }: { inventory: Inventory }) {
  const [search, setSearch] = useState('');
  const [state, setState] = useState('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const matches = inventory.rows.filter(row => row.label.toLowerCase().includes(search.toLowerCase().trim())
    && (state === 'all' || row.state === state) && (!errorsOnly || row.has_error === true));
  return <details className="status-source-details">
    <summary>Inspect {definitions[inventory.owner].title.toLowerCase()}</summary>
    <div className="status-source-filters">
      <label>Search labels<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>Reporting state<select value={state} onChange={event => setState(event.target.value)}>
        <option value="all">All states</option>{states.map(value => <option key={value} value={value}>{stateLabels[value]}</option>)}
      </select></label>
      <label className="status-source-error-filter"><input type="checkbox" checked={errorsOnly}
        onChange={event => setErrorsOnly(event.target.checked)} />Reported errors only</label>
    </div>
    <p>Showing {count(Math.min(matches.length, 50))} of {count(matches.length)} matching rows in {inventory.complete ? 'this inventory' : 'the returned slice'}.
      {' '}Search and filters use all {count(inventory.rows.length)} retained rows; at most 50 are displayed.</p>
    <div className="status-source-table-scroll"><table className="status-source-table">
      <caption>{definitions[inventory.owner].title} · activity states as of {stamp(inventory.measured_at)}</caption>
      <thead><tr>{['Label', 'Enabled', 'Cadence', 'Last activity', 'State', 'Reported error'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead>
      <tbody>{matches.slice(0, 50).map(row => <tr key={row.id}>
        <th scope="row">{row.label || 'Unnamed source'}</th><td>{row.enabled === null ? 'Unknown' : row.enabled ? 'Yes' : 'No'}</td>
        <td>{row.cadence_minutes !== null && row.cadence_minutes > 0 ? `${count(row.cadence_minutes)} min` : 'Unconfigured'}</td>
        <td>{stamp(row.last_activity_at)}</td><td>{stateLabels[row.state]}</td>
        <td>{row.has_error === null ? 'Unmeasured' : row.has_error ? 'Error reported' : 'None reported'}</td>
      </tr>)}</tbody>
    </table></div>
    {matches.length === 0 && <p>No rows match these filters.</p>}
  </details>;
}

export default function SourceOperatingInventory({ reading, failed, loading }: {
  reading: SourceOperatingReading | null; failed: boolean; loading: boolean;
}) {
  return <section id="status-reporting" className="status-source-operating" aria-labelledby="status-reporting-title">
    <div className="status-section-head"><div><div className="status-kicker">SOURCE OPERATING INVENTORY</div>
      <h3 id="status-reporting-title">Which sources show recent activity?</h3></div></div>
    <p>Platforms, scrape targets, feed targets and forums overlap. Their counts are separate inventories, not one total of sources or vehicles.</p>
    <p className="status-basis">Activity markers are compared with each row's configured cadence at the reading time.
      {' '}Enabled means the inventory flag; worker schedules, pauses and retry backoff can prevent a visit.
      {' '}A completed check can find zero new items; use <a href="#status-jobs">job checks and source intake receipts</a> for execution and delivery evidence.</p>
    <div className="status-source-inventories">{owners.map(owner => {
      const inventory = reading?.inventories[owner];
      const unavailable = failed || reading?.unavailable.includes(owner);
      const rows = inventory?.rows ?? [];
      const enabled = rows.filter(row => row.enabled === true).length;
      const unknownEnabled = rows.filter(row => row.enabled === null).length;
      const errorsMeasured = rows.filter(row => row.has_error !== null).length;
      const statesCount = Object.fromEntries(states.map(state => [state, rows.filter(row => row.state === state).length])) as Record<OperatingState, number>;
      return <article key={owner} className="status-source-owner" data-owner={owner} aria-labelledby={`status-source-${owner}`}>
        <h4 id={`status-source-${owner}`}>{definitions[owner].title}</h4><p className="status-source-owner-name">{owner}</p>
        {unavailable && <p role="status">{inventory ? 'Refresh unavailable. Stale reading retained below.' : 'Inventory unavailable. Counts unmeasured.'}</p>}
        {!inventory && !unavailable && <p role="status">{loading ? 'Reading inventory…' : 'Inventory unavailable. Counts unmeasured.'}</p>}
        {inventory && <>
          <p className="status-basis">Read {stamp(inventory.measured_at)} · {inventory.complete ? 'Complete owner inventory' : 'Returned slice · full inventory totals withheld'}</p>
          {inventory.complete ? <dl className="status-source-counts">
            <div><dt>Inventory</dt><dd>{count(rows.length)} {inventory.unit}</dd></div>
            <div><dt>Enabled</dt><dd>{count(enabled)}{unknownEnabled > 0 && ` known · ${count(unknownEnabled)} unknown`}</dd></div>
            <div><dt>Recent activity / enabled</dt><dd>{enabled > 0 ? `${count(statesCount.recent_activity)} / ${count(enabled)}` : unknownEnabled > 0 ? 'Unmeasured' : '0 / 0 · none enabled'}</dd></div>
            <div><dt>Overdue</dt><dd>{count(statesCount.overdue)}</dd></div>
            <div><dt>Never reported</dt><dd>{count(statesCount.never_reported)}</dd></div>
            <div><dt>Reported errors</dt><dd>{errorsMeasured ? `${count(rows.filter(row => row.has_error === true).length)} / ${count(errorsMeasured)} measured${errorsMeasured < rows.length ? ` · ${count(rows.length - errorsMeasured)} unmeasured` : ''}` : 'Unmeasured'}</dd></div>
          </dl> : <p>{count(rows.length)} {inventory.unit} returned; enabled, recent-activity and error totals are unmeasured for the full inventory.</p>}
          {inventory.complete && <p className="status-basis">{count(statesCount.cadence_missing)} enabled with cadence missing · {count(statesCount.invalid_clock)} invalid clocks · {count(statesCount.configuration_unknown)} configuration unknown.
            {' '}All known enabled rows remain in the activity denominator, including rows without cadence. Unknown enabled states are separate.</p>}
          <p className="status-basis">{definitions[owner].explanation}</p>
          <InventoryDetails inventory={inventory} />
        </>}
      </article>;
    })}</div>
  </section>;
}
