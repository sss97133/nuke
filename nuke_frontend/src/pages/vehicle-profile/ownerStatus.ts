// Verified ownership is a fact about a person and a vehicle, never about the vehicle alone.
// vehicles.ownership_verified records that someone proved ownership; it makes the signed-in
// viewer the verified owner only when the record names them. Otherwise only their own approved
// verification, with both documents on file, does. Anyone else is a reader.
export type OwnedVehicleLike = { ownership_verified?: boolean | null; user_id?: string | null; owner_id?: string | null } | null | undefined;
export type OwnershipClaimLike =
  | { user_id?: string | null; status?: string | null; title_document_url?: string | null; drivers_license_url?: string | null }
  | null
  | undefined;

const filed = (url: string | null | undefined) => !!url && url !== 'pending';

export function isVerifiedOwnerOf(vehicle: OwnedVehicleLike, uid: string | null | undefined, claim: OwnershipClaimLike): boolean {
  if (!uid) return false;
  const namedOnRecord = vehicle?.user_id === uid || vehicle?.owner_id === uid;
  if (vehicle?.ownership_verified && namedOnRecord) return true;
  if (!claim || claim.user_id !== uid) return false;
  return claim.status === 'approved' && filed(claim.title_document_url) && filed(claim.drivers_license_url);
}
