// Nuke Asset Advisor — curated read-only tool catalog (6 tools that work).
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
      "Find a vehicle in Nuke by VIN, listing URL, or year/make/model text. Use when you need an asset_id before get_asset, get_comps, or value_asset.",
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
    name: "get_asset",
    description:
      "Load one vehicle's identity, price facts, coverage, and sale/relist history with citations. Use after find_asset when you have an asset_id.",
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
      "Return comparable confirmed sales for a vehicle (variant-matched, deduped). Use to inspect peer hammers with source URLs and dates.",
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Subject vehicle UUID (preferred)" },
        make: { type: "string" },
        model: { type: "string" },
        year: { type: "number" },
        limit: { type: "number", description: "Max comps (1-25, default 10)" },
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
    name: "value_asset",
    description:
      "Estimate value for a known asset_id from recent same-asset sales and variant-matched comps. Use when you already have the Nuke vehicle id.",
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
  {
    name: "budget_options",
    description:
      "Rank what kinds of collector cars a budget typically buys: segments whose all-in cost (hammer + buyer fee + transport + paperwork) fits, with sales counts, price ranges, 3-year trend and why. Options, not financial advice.",
    inputSchema: {
      type: "object",
      properties: {
        budget_usd: { type: "number", description: "Total budget in US dollars, all-in (e.g. 75000)" },
        limit: { type: "number", description: "Max options (1-12, default 6)" },
      },
      required: ["budget_usd"],
    },
    outputSchema: OUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Budget Options",
    },
  },
];

export const ADVISOR_TOOL_NAMES = new Set(ADVISOR_TOOLS.map((t) => t.name));

export const ADVISOR_SERVER_INFO = {
  name: "nuke-asset-advisor",
  version: "1.1.0",
  title: "Nuke Asset Advisor",
};

export const ADVISOR_INSTRUCTIONS =
  "Nuke Asset Advisor is a read-only, citation-first ledger for collector vehicles. " +
  "Prefer evaluate_listing for any listing URL. Use find_asset → get_asset / get_comps / value_asset for known VINs or asset ids. Use budget_options for 'what can I buy with $X'. " +
  "Never invent missing values — report 'not recorded'. Every number must cite source_url and event_time when present. " +
  "Asking prices are not sales. Confidence is capped at 0.6 until a published sale backtest justifies more. " +
  "This surface has no write, admin, shop, SQL, or legacy catalog tools.";
