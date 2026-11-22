// JSON-RPC handlers for the advisor surface only (kept out of the ChatGPT surface_test slice).
import {
  createAdvisorHandlers,
  type AdvisorDeps,
  type AdvisorToolResult,
} from "./handlers.ts";
import {
  ADVISOR_INSTRUCTIONS,
  ADVISOR_SERVER_INFO,
  ADVISOR_TOOL_NAMES,
  ADVISOR_TOOLS,
} from "./tools.ts";
import { publicAnswer, publicOnlyClient } from "./public.ts";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcResult(id: string | number | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(
  id: string | number | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

type HandlerMap = Record<string, (args: Record<string, unknown>) => Promise<AdvisorToolResult>>;
let handlers: HandlerMap | null = null;
let publicHandlers: HandlerMap | null = null;

/**
 * The same six handlers twice: once on the caller's full deps (service key / active admin), once in the public scope
 * (advisor/public.ts): public-only reads, no writes, no edge calls (vision or comps fallback), Bring a Trailer only.
 */
export function initAdvisorHandlers(deps: AdvisorDeps): void {
  handlers = createAdvisorHandlers(deps);
  publicHandlers = createAdvisorHandlers(publicDeps(deps));
}

/** Deps for a caller who is not the service key or an active admin. */
export function publicDeps(deps: AdvisorDeps): AdvisorDeps {
  return {
    sb: () => publicOnlyClient(deps.sb()),
    callEdgeApi: (endpoint: string) => Promise.reject(new Error(`api-v1-${endpoint} is not available to a public call`)),
    publicOnly: true,
  };
}

export interface AdvisorCallOptions {
  /** The caller is not the service key or an active admin: run the public scope and return the public answer. */
  publicCaller?: boolean;
}

export async function handleAdvisorJsonRpc(
  body: JsonRpcRequest,
  opts: AdvisorCallOptions = {},
): Promise<JsonRpcResponse | null> {
  const active = opts.publicCaller ? publicHandlers : handlers;
  if (!active) {
    return rpcError(body.id, -32603, "Advisor handlers not initialized");
  }

  if (body.id === undefined || body.id === null) {
    if (
      body.method === "notifications/initialized" ||
      body.method === "notifications/cancelled"
    ) {
      return null;
    }
    return null;
  }

  switch (body.method) {
    case "initialize":
      return rpcResult(body.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: ADVISOR_SERVER_INFO,
        instructions: ADVISOR_INSTRUCTIONS,
      });
    case "tools/list":
      return rpcResult(body.id, { tools: ADVISOR_TOOLS });
    case "tools/call": {
      const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name || typeof params.name !== "string") {
        return rpcError(body.id, -32602, "Missing tool name");
      }
      if (!ADVISOR_TOOL_NAMES.has(params.name)) {
        return rpcError(
          body.id,
          -32602,
          `Tool not available on Nuke Asset Advisor surface: ${params.name}. ` +
            `Advisor tools: ${[...ADVISOR_TOOL_NAMES].join(", ")}`,
        );
      }
      const handler = active[params.name];
      if (!handler) {
        return rpcError(body.id, -32602, `Unknown advisor tool: ${params.name}`);
      }
      try {
        const result = await handler(params.arguments || {});
        return rpcResult(body.id, opts.publicCaller ? publicAnswer(result) : result);
      } catch (e) {
        const msg = opts.publicCaller ? "The advisor could not answer this request." : e instanceof Error ? e.message : String(e);
        return rpcResult(body.id, {
          content: [{ type: "text", text: JSON.stringify({ error: msg }) }],
          structuredContent: { error: msg, tool: params.name, claims: [] },
          isError: true,
        });
      }
    }
    case "ping":
      return rpcResult(body.id, {});
    default:
      return rpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}
