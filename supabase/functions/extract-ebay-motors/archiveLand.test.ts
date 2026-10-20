// Run: deno test supabase/functions/extract-ebay-motors/archiveLand.test.ts
// An archived eBay page (2009-2013) is history: its episode ends, and a vehicle known only from archived pages is
// neither for sale nor public inventory. Measured 2026-10-20: 2,619 archive episodes read 'active' and 13,560 archive
// vehicles read sale_status 'available', which vehicle_price_facts shows as a live "Asking" price on the profile.
import { archivedEpisodeState, archiveOnlyVehicleCorrections } from "./archiveLand.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const wb = { source: "ebay-wayback" };

Deno.test("a page captured while live ends its episode, with no outcome claimed", () => {
  const s = archivedEpisodeState("live", "20120712003235");
  eq(s.event_status, "ended");
  if (!s.end_state_note?.includes("2012-07-12") || !s.end_state_note.includes("unknown")) throw new Error(String(s.end_state_note));
});

Deno.test("sold pages stay dated sales; every other ended page ends", () => {
  eq(archivedEpisodeState("winning_bid", "20100429052133").event_status, "sold");
  eq(archivedEpisodeState("sold_for", "20100429052133").event_status, "sold");
  for (const o of ["reserve_not_met", "ended_no_bids", "ended_by_seller", "ended"] as const) {
    eq(archivedEpisodeState(o, "20100429052133"), { event_status: "ended", end_state_note: null });
  }
});

Deno.test("an archive-only vehicle stops reading as for sale and leaves public inventory", () => {
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "ebay_motors" }, [wb], false),
    { sale_status: { value: "ended", expected: "available" }, hide: true });
  eq(archiveOnlyVehicleCorrections({ sale_status: null, is_public: true, source: "ebay_motors" }, [wb, wb], false),
    { sale_status: { value: "ended", expected: null }, hide: true });
});

Deno.test("a sold archive-only vehicle keeps its dated sale and is hidden", () => {
  eq(archiveOnlyVehicleCorrections({ sale_status: "sold", is_public: true, source: "ebay_motors" }, [wb], true), { hide: true });
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "ebay_motors" }, [wb], true), { hide: true });
});

Deno.test("a vehicle any other source holds is left as that source keeps it", () => {
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "ebay_motors" }, [wb, { source: "ebay-browse-api" }], false), null);
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "ebay_motors" }, [wb, { source: null }], false), null);
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "ebay_motors" }, [], false), null);
});

Deno.test("a vehicle another intake created, or someone holds, is not touched", () => {
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "barrett-jackson" }, [wb], false), null);
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "ebay_motors", owner_id: "u1" }, [wb], false), null);
  eq(archiveOnlyVehicleCorrections({ sale_status: "available", is_public: true, source: "ebay_motors", user_id: "u1" }, [wb], false), null);
});

Deno.test("nothing to do when the row already reads as history", () => {
  eq(archiveOnlyVehicleCorrections({ sale_status: "ended", is_public: false, source: "ebay_motors" }, [wb], false), null);
  eq(archiveOnlyVehicleCorrections({ sale_status: "not_sold", is_public: false, source: "ebay_motors" }, [wb], false), null);
});
