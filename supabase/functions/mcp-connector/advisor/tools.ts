// Nuke Asset Advisor — curated read-only tool catalog.
import { ENVELOPE_OUTPUT_SCHEMA } from "./evidence.ts";

export interface AdvisorToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    openWorldHint: boolean;
    title: string;
  };
}

const OUT = ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>;

export const ADVISOR_TOOLS: AdvisorToolDef[] = [
  {
    name: "find_asset",
    description:
      "Find a vehicle in Nuke by VIN, listing URL, or year/make/model text. Excludes soft-deleted and merged rows; follows merges to the survivor. Use when you need an asset_id.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "VIN, listing URL, or free text (e.g. '1995 Porsche 911 Turbo')",
        },
      },
      required: ["query"],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Find Asset",
    },
  },
  {
    name: "find_listings",
    description:
      "Search currently for-sale asks and live auctions (not hammers). Filter by price, location, ends_before, source, and query. Stale asks are excluded by default.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional year/make/model text" },
        make: { type: "string" },
        model: { type: "string" },
        year_from: { type: "number" },
        year_to: { type: "number" },
        price_min: { type: "number" },
        price_max: { type: "number" },
        location: { type: "string" },
        source: { type: "string", description: "Platform slug e.g. bat, cars_and_bids, craigslist" },
        ends_before: { type: "string", description: "ISO date — auction ends before" },
        include_stale: { type: "boolean", description: "Include asks older than stale_after_days" },
        stale_after_days: { type: "number", description: "Default 45" },
        page: { type: "number" },
        limit: { type: "number", description: "1-50, default 20" },
      },
      required: [],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Find Listings",
    },
  },
  {
    name: "get_asset",
    description:
      "Load one vehicle's identity from vehicle_field_consensus (then canonical columns, then observations), price facts, coverage, and deduped sale/relist history with observation citations.",
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Vehicle UUID from find_asset" },
      },
      required: ["asset_id"],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Get Asset",
    },
  },
  {
    name: "get_comps",
    description:
      "Return comparable confirmed sales (dated hammers only). Resolves subject trim/body/transmission from consensus. Excludes ask-only platforms. Dedupes by canonical URL. Supports limit up to 100 with offset paging and body/transmission/miles filters.",
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Subject vehicle UUID (preferred)" },
        make: { type: "string" },
        model: { type: "string" },
        year: { type: "number" },
        body: { type: "string", description: "cabriolet|coupe|targa|…" },
        transmission: { type: "string", description: "manual|automatic|g50|…" },
        miles_min: { type: "number" },
        miles_max: { type: "number" },
        limit: { type: "number", description: "Max comps (1-100, default 10)" },
        offset: { type: "number", description: "Paging offset" },
      },
      required: [],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Get Comparables",
    },
  },
  {
    name: "get_history",
    description:
      "Timeline of market events and observations for one asset. Events are deduped by canonical URL; ask-only platforms never get price_role=hammer.",
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Vehicle UUID" },
        limit: { type: "number", description: "1-100, default 25" },
      },
      required: ["asset_id"],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Get History",
    },
  },
  {
    name: "value_asset",
    description:
      "Estimate value for a known asset_id from recent same-asset sales and variant-matched dated comps. Returns value_low/value_high and the comps used. Confidence capped at 0.6 pending published backtest.",
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Vehicle UUID" },
      },
      required: ["asset_id"],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Value Asset",
    },
  },
  {
    name: "evaluate_listing",
    description:
      "Evaluate a public listing URL: verdict, value range, prior sales/relists of the same car, top comps, and red flags. Prefer this for any 'is this a good buy?' question.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public listing URL (BaT, Cars & Bids, Craigslist, …)" },
      },
      required: ["url"],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      title: "Evaluate Listing",
    },
  },
];

export const ADVISOR_TOOL_NAMES = new Set(ADVISOR_TOOLS.map((t) => t.name));

export const ADVISOR_SERVER_INFO = {
  name: "nuke-asset-advisor",
  version: "1.2.0",
  title: "Nuke Asset Advisor",
};

export const ADVISOR_INSTRUCTIONS =
  "Nuke Asset Advisor is a read-only, citation-first ledger for collector vehicles. " +
  "Prefer evaluate_listing for any listing URL. Use find_listings for active asks. " +
  "Use find_asset → get_asset / get_comps / get_history / value_asset for known VINs or asset ids. " +
  "Never invent missing values — report 'not recorded'. Every number must cite source_url and event_time when present. " +
  "Asking prices are not sales. Soft-deleted and merged vehicles are excluded; merges are followed to the survivor. " +
  "Spec fields come from vehicle_field_consensus (then canonical columns, then observations) with observation citations — confidence is never hard-coded. " +
  "Confidence on estimates is capped at 0.6 until a published sale backtest justifies more. " +
  "This surface has no write, admin, shop, SQL, or legacy catalog tools.";
