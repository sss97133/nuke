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
