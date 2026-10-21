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

let handlers: Record<string, (args: Record<string, unknown>) => Promise<AdvisorToolResult>> | null =
  null;

export function initAdvisorHandlers(deps: AdvisorDeps): void {
  handlers = createAdvisorHandlers(deps);
}

export async function handleAdvisorJsonRpc(
  body: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  if (!handlers) {
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
      const handler = handlers[params.name];
      if (!handler) {
        return rpcError(body.id, -32602, `Unknown advisor tool: ${params.name}`);
      }
      try {
        const result = await handler(params.arguments || {});
        return rpcResult(body.id, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
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
