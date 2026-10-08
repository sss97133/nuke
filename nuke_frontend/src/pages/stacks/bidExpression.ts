import type { BidExpression, BidGrouping, BidMeasure } from './bidMeasurements';

export function expressionFromParams(params: URLSearchParams): BidExpression {
  const year = new Date().getUTCFullYear();
  const rawMeasure = params.get('measure') as BidMeasure, rawGroup = params.get('by') as BidGrouping;
  const grouping = ['make', 'model', 'year', 'participant', 'auction'].includes(rawGroup) ? rawGroup : 'make';
  const measure = ['amount', 'increment', 'relative', 'typical', 'winRate', 'entry', 'spacing', 'participants', 'bids'].includes(rawMeasure)
    && !(grouping === 'participant' && rawMeasure === 'participants') && !(grouping !== 'participant' && ['winRate','entry'].includes(rawMeasure)) ? rawMeasure : 'typical';
  const from = Math.max(2014, Math.min(year, Math.trunc(Number(params.get('from'))) || 2016));
  const to = Math.max(from, Math.min(year, Math.trunc(Number(params.get('to'))) || year));
  const vehicleYear = Number(params.get('vehicleYear'));
  return { measure, grouping, from, to, make: params.get('make') || null, model: params.get('model') || null,
    vehicleYear: Number.isInteger(vehicleYear) && vehicleYear >= 1886 && vehicleYear <= year + 2 ? vehicleYear : null,
    weighting: params.get('weight') === 'bid' && ['amount','increment','relative'].includes(measure) ? 'bid' : 'auction' };
}

export const measures: Record<BidMeasure, { label: string; unit: string; definition: string; equation: string }> = {
  amount: { label: 'Mean bid', unit: 'Source-listed USD', definition: 'Average submitted amount. This includes the opening bid; it is different from the size of a raise.', equation: 'Sum of bid amounts / bid count' },
  increment: { label: 'Mean raise', unit: 'Source-listed USD', definition: 'The increase over the immediately preceding standing bid, across all participants. The opening bid has no known increment.', equation: 'Raise = bid − preceding standing bid' },
  relative: { label: 'Mean relative raise', unit: '% of preceding bid', definition: 'Each valid raise expressed as a percentage of the preceding standing bid. Small opening amounts can produce very large percentages.', equation: 'Relative raise = 100 × raise / preceding bid' },
  typical: { label: 'Average record median raise', unit: '% of preceding bid', definition: 'First take the median relative raise within each auction record, then average those record medians within each group. This measures bidding behavior, rather than vehicle value.', equation: 'Record reading = median(100 × raise / preceding bid)\nGroup dot = mean(record readings)' },
  spacing: { label: 'Average record median gap', unit: 'Seconds', definition: 'First take the median gap between consecutive observed bids within each record, then average those medians. Missing events and phase differences can affect comparisons.', equation: 'Gap = later bid time − preceding bid time' },
  entry: { label: 'Entry timing', unit: '% of observed first-to-terminal bid span', definition: 'Where a participant first entered the completed observed bid span. This is not time before the scheduled close, and cannot be used unchanged in an earlier forecast.', equation: '100 × (entry − first bid) / (terminal bid − first bid)' },
  winRate: { label: 'Captured win conversion', unit: '% of attributed auction outcomes', definition: 'Recorded wins divided by captured outcomes with a resolved winner. Ranked participants require at least five such outcomes. This is a captured record, rather than a lifetime or skill rating.', equation: '100 × recorded wins / attributed outcomes' },
  participants: { label: 'Participants per auction', unit: 'Canonical identities', definition: 'Distinct keyed participants in a complete auction sequence. An unresolved author is not another known participant.', equation: 'Count of distinct canonical identities per auction' },
  bids: { label: 'Bids per record', unit: 'Bids', definition: 'The number of bids in each complete record. Activity is different from an amount or the quality of a purchase.', equation: 'Count of admitted bid events per record' },
};
export const groupNames: Record<BidGrouping, string> = { make: 'Make', model: 'Model label', year: 'Bid calendar year', participant: 'Participant', auction: 'Auction' };
export const groupDefinitions: Record<BidGrouping, string> = {
  make: 'Group the selected auction records by their recorded make. Switching this key rearranges the same selected population; it does not broaden the vehicle or calendar scope.',
  model: 'Group by the retained normalized model label, with source-label fallback where normalization is unavailable. A shared model label alone does not establish generation, configuration or condition-matched peers.',
  year: 'Group by the UTC year when each bid was posted. An auction crossing New Year can contribute to two auction-year records. This is independent of the vehicle model year.',
  participant: 'Group by canonical participant identity across captured auctions. Entry and outcome comparisons require their own eligible records; names alone never merge identities.',
  auction: 'One observed auction record per row. Percentiles compare its selected measurement with the named reference records, rather than prices or vehicle quality.',
};
export function groupingChange(expression: BidExpression, grouping: BidGrouping): Record<string, string | null> {
  return { by: grouping, group: null, ...(grouping === 'participant' && expression.measure === 'participants' ? { measure: 'bids' } : grouping !== 'participant' && ['winRate', 'entry'].includes(expression.measure) ? { measure: 'typical', paired: null } : {}) };
}
