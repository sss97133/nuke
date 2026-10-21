// Nuke Asset Advisor — curated read-only tool catalog (~7 asset-generic tools).
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

const CITE =
  " Always cite sources and event dates from the response claims[]; never invent missing values — report 'not recorded'.";

const ASSET_TYPE = {
  type: "string",
  description: "Asset class. Defaults to 'vehicle'. Future: art, watch, etc.",
  default: "vehicle",
  enum: ["vehicle"],
};

export const ADVISOR_TOOLS: AdvisorToolDef[] = [
  {
    name: "find_asset",
    description:
      "Search Nuke for physical assets (vehicles first). Query by VIN, listing URL, year/make/model, or free text. " +
      "Returns matched assets with cited identity claims." +
      CITE,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "VIN, URL, year, '1974 Karmann Ghia', or free text" },
        asset_type: ASSET_TYPE,
        limit: { type: "number", description: "Max results (1-25, default 10)" },
      },
      required: ["query"],
    },
    outputSchema: ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
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
      "Get one asset's identity, specs, and current price facts as cited claims. " +
      "Missing fields return value 'not recorded' with checked_sources." +
      CITE,
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Asset UUID (vehicle id today)" },
        asset_type: ASSET_TYPE,
      },
      required: ["asset_id"],
    },
    outputSchema: ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Get Asset",
    },
  },
  {
    name: "get_history",
    description:
      "Provenance timeline for an asset: market events and observations. " +
      "Each entry separates event_time (e.g. sold_at) from ingested_at." +
      CITE,
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        asset_type: ASSET_TYPE,
        limit: { type: "number", description: "Max events/observations (default 25)" },
      },
      required: ["asset_id"],
    },
    outputSchema: ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Get Asset History",
    },
  },
  {
    name: "explain_field",
    description:
      "Explain how Nuke knows one field on an asset — observation testimony, field evidence, and consensus projection when available." +
      CITE,
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        field: {
          type: "string",
          description: "Field name, e.g. mileage, exterior_color, sale_price, year, make, model",
        },
        asset_type: ASSET_TYPE,
      },
      required: ["asset_id", "field"],
    },
    outputSchema: ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Explain Field",
    },
  },
  {
    name: "value_asset",
    description:
      "Return Nuke's valuation for an asset (estimate, range, confidence) with citations. " +
      "Reads stored estimates; does not force a recompute." +
      CITE,
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        asset_type: ASSET_TYPE,
      },
      required: ["asset_id"],
    },
    outputSchema: ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Value Asset",
    },
  },
  {
    name: "get_comps",
    description:
      "Comparable sold assets for valuation context. Each comp is a cited sale with event_time = sold_date." +
      CITE,
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string", description: "Subject asset UUID (preferred)" },
        make: { type: "string" },
        model: { type: "string" },
        year: { type: "number" },
        asset_type: ASSET_TYPE,
        limit: { type: "number", description: "Max comps (1-25, default 10)" },
      },
      required: [],
    },
    outputSchema: ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Get Comparables",
    },
  },
  {
    name: "get_coverage",
    description:
      "Data coverage report for an asset: which key fields are recorded vs not recorded, " +
      "observation/event/image counts, and sources consulted." +
      CITE,
    inputSchema: {
      type: "object",
      properties: {
        asset_id: { type: "string" },
        asset_type: ASSET_TYPE,
      },
      required: ["asset_id"],
    },
    outputSchema: ENVELOPE_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      title: "Get Coverage",
    },
  },
];

export const ADVISOR_TOOL_NAMES = new Set(ADVISOR_TOOLS.map((t) => t.name));

export const ADVISOR_SERVER_INFO = {
  name: "nuke-asset-advisor",
  version: "1.0.0",
  title: "Nuke Asset Advisor",
};

export const ADVISOR_INSTRUCTIONS =
  "You are using the Nuke Asset Advisor — a read-only, citation-first ledger for physical assets (vehicles first). " +
  "RULES: (1) Never fabricate asset facts. (2) Every answer must cite claims[].citations with source_name, source_url, and event_time when present. " +
  "(3) event_time is the real-world event (e.g. sold_at); ingested_at is when Nuke learned it — never conflate them. " +
  "(4) If value is 'not recorded', say so and name checked_sources; do not guess. " +
  "(5) Prefer per-claim confidence; when confidence_basis is source_trust, say the score is source trust, not independent claim strength. " +
  "(6) This surface has no write, admin, shop, or SQL tools.";
