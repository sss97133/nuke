import { assertEquals } from "jsr:@std/assert";
import { normalizeClaudePayload } from "./claudeSubscriptionAuth.ts";

Deno.test("sonnet 5.5 single-shot payload: thinking off, sampling dropped, forced tool choice becomes auto", () => {
  const out = normalizeClaudePayload({
    model: "claude-haiku-4-5-20251001", temperature: 0.1, top_p: 0.9,
    thinking: { type: "disabled" }, tool_choice: { type: "tool", name: "x" }, max_tokens: 500,
  });
  assertEquals(out.model, "claude-sonnet-5-5");
  assertEquals(out.temperature, undefined);
  assertEquals(out.top_p, undefined);
  assertEquals(out.thinking, { type: "between_tools" });
  assertEquals(out.tool_choice, { type: "auto" });
  assertEquals(out.max_tokens, 500);
});

Deno.test("between_tools is not added at xhigh or max effort, where the API refuses it", () => {
  for (const effort of ["xhigh", "max"]) {
    const out = normalizeClaudePayload({ model: "claude-sonnet-5-5", output_config: { effort } });
    assertEquals(out.thinking, undefined);
  }
  const high = normalizeClaudePayload({ model: "claude-sonnet-5-5", output_config: { effort: "high" } });
  assertEquals(high.thinking, { type: "between_tools" });
});

Deno.test("a caller's own adaptive thinking is kept", () => {
  const out = normalizeClaudePayload({ model: "claude-sonnet-5-5", thinking: { type: "adaptive" } });
  assertEquals(out.thinking, { type: "adaptive" });
});

Deno.test("opus and fable ids: sampling and thinking budgets are dropped, no between_tools", () => {
  const opus = normalizeClaudePayload({ model: "claude-opus-4-8", temperature: 0, thinking: { type: "enabled", budget_tokens: 2000 } });
  assertEquals(opus.model, "claude-opus-5-5");
  assertEquals(opus.temperature, undefined);
  assertEquals(opus.thinking, undefined);
  const fable = normalizeClaudePayload({ model: "claude-fable-5-2", temperature: 0.5, top_k: 5, thinking: { type: "disabled" } });
  assertEquals(fable.model, "claude-fable-5-2");
  assertEquals(fable.temperature, undefined);
  assertEquals(fable.top_k, undefined);
  assertEquals(fable.thinking, undefined);
});

Deno.test("a non-Claude id passes through untouched", () => {
  const out = normalizeClaudePayload({ model: "gpt-4o", temperature: 0.2 });
  assertEquals(out, { model: "gpt-4o", temperature: 0.2 });
});
