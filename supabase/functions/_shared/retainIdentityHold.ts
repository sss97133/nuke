import type { ObservationInput, WriteResult } from './observationWriter.ts';

/** Keep source testimony without manufacturing a vehicle. A failed receipt is retryable. */
export async function retainIdentityHold(
  write: (input: ObservationInput) => Promise<WriteResult>,
  source: { platform: string; url: string },
  claims: Record<string, unknown>,
  issues: string[],
) {
  try {
    const result = await write({ vehicleId: null, unresolved: true, source: { ...source, sourceIdentifier: source.url },
      observationKind: 'listing', extractionMethod: 'identity_admission',
      fields: { identity_admission: 'unresolved', identity_issues: issues },
      rawData: { source_claims: claims }, hashRawData: true,
      contentText: typeof claims.listing_title === 'string' ? claims.listing_title : undefined });
    return { observation: result.observationId ? (result.duplicate ? 'duplicate' : 'written') : 'error',
      observation_id: result.observationId, errors: result.errors };
  } catch (error) {
    return { observation: 'error', observation_id: undefined,
      errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function hasIdentityHold(issues: string[]): boolean {
  return issues.some(issue => ['identity_boundary_conjunction', 'multiple_model_years_unresolved',
    'parts_lot_not_single_vehicle'].includes(issue));
}
