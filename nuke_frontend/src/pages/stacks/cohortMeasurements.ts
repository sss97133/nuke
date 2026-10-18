import { evaluateBidExpression, makeStudy, type BidExpression, type BidMeasure, type StudyDataset } from './bidMeasurements';
import type { OrderBookRead } from './orderBookReader';

/** Admit the selected episode through the existing complete-sold-sequence gate.
 * Never merge it into the retained study or label live partial bids as a completed reading. */
export function cohortReadings(dataset: StudyDataset, read: OrderBookRead, scope: string, measure: BidMeasure, period?: Pick<BidExpression, 'from' | 'to'>, referenceVehicleIds?: ReadonlySet<string>) {
  const held = dataset.lots.find(l => l.id === read.lot?.id && l.vehicleId === read.vehicle.id && l.sourceUrl.replace(/\/+$/, '') === read.lot?.source_url.replace(/\/+$/, ''));
  const admitted = held ? null : makeStudy(read.lot ? [{
    id:read.lot.id, vehicle_id:read.vehicle.id, source:read.lot.source, source_url:read.lot.source_url,
    auction_end_date:read.lot.auction_end_date, total_bids:read.lot.total_bids,
    winning_bid:read.lot.outcome === 'sold' ? read.lot.winning_bid : null,
    winning_bidder_external_identity_id:read.lot.winning_bidder_external_identity_id,
    vehicles:{...read.vehicle, normalized_model:read.vehicle.normalized_model ?? null},
  }] : [], read.comments.filter(c => c.comment_type === 'bid').map(c => ({
    ...c, auction_event_id:read.lot!.id, vehicle_id:read.vehicle.id, created_at:c.created_at ?? '',
  })),read.readAt,'Selected source episode',false);
  const subject = held ?? admitted?.lots[0] ?? null;
  const make = subject?.make ?? read.vehicle.make, model = subject?.model ?? read.vehicle.normalized_model ?? null;
  const vehicleYear = subject?.vehicleYear ?? read.vehicle.year;
  const effectiveScope = scope === 'make' || !model ? 'make' : scope === 'vehicleYear' && vehicleYear !== null ? 'vehicleYear' : 'model';
  const expression: BidExpression = { measure, grouping:'auction', from:period?.from ?? 2016, to:period?.to ?? new Date(dataset.readAt).getUTCFullYear(),
    make, model:effectiveScope === 'make' ? null : model, vehicleYear:effectiveScope === 'vehicleYear' ? vehicleYear : null, weighting:'auction' };
  // All other episodes of this vehicle are withheld from its reference too.
  const peers = {...dataset,lots:dataset.lots.filter(l => l.vehicleId !== read.vehicle.id && (!referenceVehicleIds || referenceVehicleIds.has(l.vehicleId)))};
  const result = evaluateBidExpression(peers,expression);
  const subjectResult = subject ? evaluateBidExpression({...dataset,lots:[subject]},expression) : null;
  return {result,expression,subject,reading:read.lot?.outcome === 'sold' ? subjectResult?.groups[0]?.mean ?? null : null,make,model,vehicleYear,effectiveScope,
    admissionFailure:read.lot?.outcome !== 'sold' ? 'selected episode is not recorded sold' : admitted?.exclusions[0]?.reason ?? null};
}
