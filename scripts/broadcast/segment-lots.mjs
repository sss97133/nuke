/** Turn per-frame overlay readings into lot presentations.
 * A presentation is the span during which one lot's overlay was on screen, with the displayed bid ladder
 * and status changes. Frames without an overlay (replays, interviews, ads) do not end a presentation; a
 * different lot that holds the screen for MIN_RUN samples does.
 */

const MIN_RUN = 3;
const MERGE_GAP_S = 180;

const mode = values => {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null; let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
};

function runsOf(readings) {
  const runs = [];
  for (const r of readings) {
    const last = runs.at(-1);
    if (last && last.lot === r.lot) last.items.push(r);
    else runs.push({ lot: r.lot, items: [r] });
  }
  return runs;
}

/** Keep a displayed amount only when two consecutive samples agree, so one misread digit cannot
 * enter the ladder; the final sample of a presentation is also kept when it repeats the prior value. */
function bidLadder(items) {
  const ladder = [];
  for (let i = 0; i < items.length; i++) {
    const v = items[i].displayed_bid;
    if (v == null) continue;
    const confirmed = items.slice(i + 1, i + 3).some(n => n.displayed_bid === v);
    if (!confirmed) continue;
    if (ladder.at(-1)?.amount === v) continue;
    if (ladder.length && v < ladder.at(-1).amount) {
      // A lower value after a higher one is either a misread of the earlier value or a reset; keep
      // the ladder monotone and record the dip for review instead of rewriting history.
      ladder.at(-1).later_lower_display = (ladder.at(-1).later_lower_display ?? 0) + 1;
      continue;
    }
    ladder.push({ t: items[i].t, amount: v });
  }
  // A step contradicted by more later lower frames than frames showing it was a misread, not a bid.
  const support = amount => items.filter(n => n.displayed_bid === amount).length;
  return ladder.filter(step => !(step.later_lower_display > support(step.amount)));
}

// Outcome graphics flash for about a second; the overlay parser already restricts them to their position.
const TERMINAL = new Set(['sold', 'bid_goes_on', 'no_sale']);

function statusChanges(items) {
  const changes = [];
  for (let i = 0; i < items.length; i++) {
    const s = items[i].status;
    if (!s || changes.at(-1)?.status === s) continue;
    if (!TERMINAL.has(s) && !items.slice(i + 1, i + 3).some(n => n.status === s) && i !== items.length - 1) continue;
    changes.push({ t: items[i].t, status: s });
  }
  return changes;
}

/** At 360p the decimal point of a sub-lot is often lost ("921.1" read as "9211"). A dotless reading whose
 * title matches a reading of the same digits with the point is that sub-lot. */
function restoreDroppedPoints(readings) {
  const dotted = new Map();
  for (const r of readings) if (r.lot.includes('.') && r.title) dotted.set(`${r.lot.replace('.', '')}|${r.title}`, r.lot);
  return readings.map(r => {
    const lot = !r.lot.includes('.') && dotted.get(`${r.lot}|${r.title}`);
    return lot ? { ...r, lot } : r;
  });
}

export function segmentLots(readings, { sampleSeconds = 1 } = {}) {
  const withLot = restoreDroppedPoints(readings.filter(r => r && r.lot));
  const runs = runsOf(withLot).filter(r => r.items.length >= MIN_RUN);
  const merged = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.lot === run.lot && run.items[0].t - last.items.at(-1).t <= MERGE_GAP_S) last.items.push(...run.items);
    else merged.push({ lot: run.lot, items: [...run.items] });
  }
  return merged.map(({ lot, items }) => {
    const ladder = bidLadder(items);
    const statuses = statusChanges(items);
    const seen = new Set(statuses.map(s => s.status));
    const displayed_outcome = seen.has('sold') ? 'sold'
      : seen.has('bid_goes_on') ? 'bid_goes_on'
      : seen.has('no_sale') ? 'no_sale' : 'unknown';
    const start = items[0].t; const end = items.at(-1).t;
    return {
      lot,
      publisher: mode(items.map(i => i.publisher)),
      title: mode(items.map(i => i.title)),
      sale: mode(items.map(i => i.sale)),
      start_s: start,
      end_s: end + sampleSeconds,
      overlay_samples: items.length,
      overlay_coverage: Number((items.length * sampleSeconds / (end - start + sampleSeconds)).toFixed(3)),
      bid_ladder: ladder,
      first_displayed_bid: ladder[0]?.amount ?? null,
      final_displayed_bid: ladder.at(-1)?.amount ?? null,
      asks_displayed: [...new Set(items.map(i => i.displayed_ask).filter(v => v != null))],
      status_changes: statuses,
      reserve_off_at_s: statuses.find(s => s.status === 'reserve_off')?.t ?? null,
      displayed_outcome,
    };
  });
}
