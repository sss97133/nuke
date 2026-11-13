/**
 * ingest/vinGate.ts — when a typed VIN may be decoded to contradict the claimed make.
 *
 * decodeVin reads a manufacturer prefix, which means something only for a 17-character VIN (1981 and later) whose
 * check digit holds. Anything shorter is a chassis or frame number: a claim by the seller, kept as testimony, never
 * decoded for make. Measured 2026-10-15: the gate rejected a 1972 Aston Martin V8 (decoded Plymouth), a 1970 MGB
 * (decoded Chevrolet), two ClassicCars listings and, earlier, 9 of 46 real Craigslist VINs, in none of which the make
 * was wrong. A 17-character VIN with a failing check digit is also not decoded: a European VIN carries no North
 * American check digit, and a mistyped one proves nothing about the make.
 */
import { vinCheckDigitOk } from "../_shared/batAuctionRecord.ts";
import { normalizeMake } from "../_shared/normalizeVehicle.ts";
import type { VINDecodeResult } from "../_shared/vin-decoder.ts";

export function vinMakeCheckApplies(vin: unknown): boolean {
  return typeof vin === "string" && vinCheckDigitOk(vin) === true;
}


/** Compatibility check only. An ambiguous manufacturer never becomes a vehicle make. */
export function vinMakeConflict(vin: unknown, claimed: unknown, decoded: VINDecodeResult) {
  if (!vinMakeCheckApplies(vin) || typeof claimed !== "string") return null;
  const cleanVin = (vin as string).toUpperCase().trim();
  // A modern WMI has three characters; low-volume identifiers additionally
  // require VIN positions 12–14. The decoder also exposes legacy two-character
  // guesses, which cannot establish counterevidence to a source's make claim.
  const manufacturerId = cleanVin.slice(0, 3) + (cleanVin[2] === "9" ? cleanVin.slice(11, 14) : "");
  if (decoded.manufacturer_match_prefix !== manufacturerId) return null;
  const claimedMake = normalizeMake(claimed);
  const candidates = decoded.make ? [decoded.make] : decoded.manufacturer_make_candidates ?? [];
  const supported = candidates.map(value => normalizeMake(value)).filter(Boolean);
  if (!claimedMake || !supported.length || supported.includes(claimedMake)) return null;
  return { expected: supported.join(" / "), claimed: claimedMake,
    basis: decoded.make ? "VIN prefix" : "WMI manufacturer compatibility" };
}
