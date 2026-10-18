// Run: deno test --allow-read supabase/functions/mcp-connector/surface_test.ts
// Load the actual definitions and protocol handlers without starting HTTP, reading
// credentials, or reaching the database. Tool handlers are spies, so denied calls
// must fail before dispatch and allowed calls must preserve their arguments.
const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const handlerNames = [...source.matchAll(/^  (\w+): handle\w+,$/gm)].map((m) => m[1]);
const moduleSource = source.slice(source.indexOf("interface JsonRpcRequest"), source.indexOf("const sb = ()")) + `
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const TOOL_HANDLERS = Object.fromEntries(${JSON.stringify(handlerNames)}.map((name: string) =>
  [name, async (args: Record<string, unknown>) => { calls.push({ name, args }); return toolOk({ name, args }); }]));
` + source.slice(source.indexOf("const SERVER_INFO"), source.indexOf("// HTTP ENTRY POINT")) + `
export { TOOLS, calls, handleJsonRpc, isChatGptSurface };
`;
const connector = await import(`data:application/typescript,${encodeURIComponent(moduleSource)}`);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("ChatGPT lists and dispatches only the public allowlist for either surface flag", async () => {
  const publicNames = [
    "describe_platform", "search_vehicles", "search_vehicles_advanced", "browse_inventory",
    "decode_vin", "get_vehicle", "get_valuation", "get_comps", "query_market_history",
    "search_organizations",
  ];
  const publicSet = new Set(publicNames);
  const allNames = connector.TOOLS.map((tool: { name: string }) => tool.name);
  assert(allNames.length === 54 && new Set(allNames).size === 54, "Full catalog must retain 54 unique tools");
  assert(handlerNames.length === 54, "Every tool must have a handler");
  for (const tool of connector.TOOLS) {
    for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
      assert(typeof tool.annotations[hint] === "boolean", `${tool.name} is missing ${hint}`);
    }
    assert(tool.annotations.title.trim().length > 0, `${tool.name} is missing a title`);
    if (publicSet.has(tool.name)) {
      assert(tool.annotations.readOnlyHint && !tool.annotations.destructiveHint, `${tool.name} must be read-only`);
    }
  }

  const requests = [
    { req: new Request("https://example.test/mcp"), public: false },
    { req: new Request("https://example.test/mcp?surface=other"), public: false },
    { req: new Request("https://example.test/mcp", { headers: { "x-nuke-surface": "other" } }), public: false },
    { req: new Request("https://example.test/mcp?surface=chatgpt"), public: true },
    { req: new Request("https://example.test/mcp", { headers: { "X-Nuke-Surface": "chatgpt" } }), public: true },
    { req: new Request("https://example.test/mcp?surface=other", { headers: { "x-nuke-surface": "chatgpt" } }), public: true },
    { req: new Request("https://example.test/mcp?surface=chatgpt", { headers: { "x-nuke-surface": "other" } }), public: true },
  ];
  for (const { req, public: curated } of requests) {
    const surface = connector.isChatGptSurface(req);
    assert(surface === curated, "Either ChatGPT flag must select the public surface");
    const list = await connector.handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, surface);
    const names = list.result.tools.map((tool: { name: string }) => tool.name).sort();
    assert(JSON.stringify(names) === JSON.stringify((curated ? publicNames : allNames).slice().sort()), "Incorrect tool list");
    for (const name of [...allNames, "future_private_tool", "constructor", "__proto__"]) {
      if (!curated && !allNames.includes(name)) continue;
      const count = connector.calls.length;
      const args = { probe: name };
      const call = await connector.handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, surface);
      if (curated && !publicSet.has(name)) {
        assert(call.error?.code === -32602, `${name} must be refused`);
        assert(connector.calls.length === count, `${name} dispatched despite the filter`);
      } else {
        assert(!call.error && connector.calls.length === count + 1, `${name} should dispatch`);
        assert(connector.calls.at(-1).args === args, `${name} arguments changed`);
      }
    }
  }
  const defaultList = await connector.handleJsonRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert(defaultList.result.tools === connector.TOOLS, "Unflagged clients must retain the full catalog");
  const missing = await connector.handleJsonRpc({ jsonrpc: "2.0", id: 4, method: "tools/call" }, true);
  assert(missing.error?.code === -32602, "Missing-name validation must remain intact");
  const unknown = await connector.handleJsonRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "unknown_tool" } });
  assert(unknown.error?.message === "Unknown tool: unknown_tool", "Unflagged unknown-tool behavior changed");
});
