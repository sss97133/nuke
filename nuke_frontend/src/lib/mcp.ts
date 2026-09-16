// Minimal MCP tool-call helper. Routes through Vercel rewrite /api/mcp -> mcp-connector edge function.
// Frontend projection surfaces call this to invoke substrate tools (project_work_log, project_invoice, etc.)
// instead of hitting bespoke edge functions per surface. See docs/library/technical/design-book/frontend-doctrine.md §1.
//
// mcp-connector speaks JSON-RPC 2.0 (MCP Streamable HTTP). A tools/call response wraps the tool's
// JSON payload inside result.content[0].text. This helper unwraps that envelope so callers get the
// inner data shape directly (e.g. { projection_event_id, work_log, ... } for project_work_log).

interface CallToolOptions {
  signal?: AbortSignal;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: {
    content?: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string; data?: unknown };
}

export async function callTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown>,
  opts?: CallToolOptions,
): Promise<T> {
  const response = await fetch("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: opts?.signal,
  });
  if (!response.ok) {
    throw new Error(`MCP transport failed for '${toolName}': HTTP ${response.status}`);
  }
  const body = (await response.json()) as JsonRpcResponse;
  if (body.error) {
    throw new Error(`MCP error for '${toolName}': ${body.error.message}`);
  }
  const text = body.result?.content?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`MCP returned no content for '${toolName}'`);
  }
  const parsed = JSON.parse(text);
  if (body.result?.isError) {
    throw new Error(`Tool '${toolName}' failed: ${parsed?.error ?? text}`);
  }
  return parsed as T;
}
