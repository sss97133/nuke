import type { CoverageRow } from './orderBookReader';
import type { LayerId, StackLayer } from './stackDefinitions';
import { STATE_WORD, clock, count, percent } from './stackFormat';

// Shared components of the stack pages: the coverage block and the nine-layer path.

/** The layer that holds the evidence behind each coverage row. */
const COVERAGE_LAYER: Record<CoverageRow['id'], LayerId> = {
  bids_keyed: 'key', bids_held: 'log', comments_keyed: 'dimension', frames: 'log', key_conflicts: 'log',
};

/** Every number with its denominator and the clock it is as of; an unknown denominator says so. */
export function CoverageTable({ rows, readAt, caption, onOpen }: {
  rows: CoverageRow[];
  readAt: number;
  caption?: string;
  /** Opens the layer that holds a row's evidence. */
  onOpen?: (layer: LayerId) => void;
}) {
  return (
    <section className="stack-coverage" aria-label="Coverage">
      <div className="stack-coverage-head">
        <span className="stack-label">Coverage{caption ? ` · ${caption}` : ''}</span>
        <span className="stack-label">Read {clock(readAt)}</span>
      </div>
      <table>
        <thead>
          <tr><th scope="col">Measure</th><th scope="col">Held / denominator</th><th scope="col">As of</th><th scope="col">Basis</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = percent(r.numerator, r.denominator);
            const width = r.denominator && r.denominator > 0 ? Math.min(1, r.numerator / r.denominator) : 0;
            return (
              <tr key={r.id} data-coverage={r.id}>
                <td>
                  {onOpen
                    ? <button type="button" className="stack-link stack-coverage-open" onClick={() => onOpen(COVERAGE_LAYER[r.id])}>{r.label}</button>
                    : <strong>{r.label}</strong>}
                </td>
                <td>
                  <span className="stack-ratio">
                    {count(r.numerator)} / {r.denominator == null ? 'unknown' : count(r.denominator)}
                    {pct && <small> · {pct}</small>}
                  </span>
                  <span className="stack-basis"> {r.of}</span>
                  {r.denominator != null && r.denominator > 0 && (
                    <span className="stack-bar" aria-hidden="true"><span style={{ width: `${width * 100}%` }} /></span>
                  )}
                </td>
                <td className="stack-mono">
                  {r.asOf == null ? 'unknown' : clock(r.asOf)}
                  <div className="stack-basis">{r.asOfBasis}</div>
                </td>
                <td className="stack-basis">{r.basis}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The nine layers in order. Each cell is a button that opens its layer; the reading is the layer's own number. */
export function LayerPath({
  layers, current, readings, onSelect,
}: {
  layers: StackLayer[];
  current: LayerId | null;
  readings: Partial<Record<LayerId, string>>;
  onSelect: (id: LayerId) => void;
}) {
  return (
    <nav className="stack-path" aria-label="Layers of this stack, log to outcome">
      {layers.map((l, i) => (
        <button
          key={l.id}
          type="button"
          className={`stack-state-${l.state}`}
          aria-current={current === l.id ? 'true' : undefined}
          onClick={() => onSelect(l.id)}
          title={l.missing ?? l.reader ?? l.holds}
        >
          <span className="stack-label">{i + 1} · {STATE_WORD[l.state]}</span>
          <span className="stack-layer-name">{l.name}</span>
          <span className="stack-layer-reading">{readings[l.id] ?? (l.state === 'missing' ? 'no reader' : '')}</span>
        </button>
      ))}
    </nav>
  );
}
