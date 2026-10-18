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

export function vinMakeCheckApplies(vin: unknown): boolean {
  return typeof vin === "string" && vinCheckDigitOk(vin) === true;
}
