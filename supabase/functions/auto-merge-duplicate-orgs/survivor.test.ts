// Contract for pickSurvivorId: the older organization survives a merge, so a freshly created duplicate can never
// absorb an older, real org. Run: deno test supabase/functions/auto-merge-duplicate-orgs/survivor.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickSurvivorId } from "./survivor.ts";

const OLD = { id: "aaaaaaaa-0000-0000-0000-000000000001", created_at: "2024-01-01T00:00:00Z" };
const NEW = { id: "bbbbbbbb-0000-0000-0000-000000000002", created_at: "2026-10-14T00:00:00Z" };

Deno.test("the older org survives, whichever argument position it is in", () => {
  assertEquals(pickSurvivorId(OLD, NEW), OLD.id);
  assertEquals(pickSurvivorId(NEW, OLD), OLD.id);
});

Deno.test("an attacker's brand-new duplicate never survives against an older real org", () => {
  const attacker = { id: "cccccccc-0000-0000-0000-000000000003", created_at: new Date().toISOString() };
  assertEquals(pickSurvivorId(attacker, OLD), OLD.id);
  assertEquals(pickSurvivorId(OLD, attacker), OLD.id);
});

Deno.test("a dated org beats one with a missing created_at", () => {
  const undatedNew = { id: "dddddddd-0000-0000-0000-000000000004", created_at: null };
  assertEquals(pickSurvivorId(OLD, undatedNew), OLD.id);
  assertEquals(pickSurvivorId(undatedNew, OLD), OLD.id);
});

Deno.test("equal timestamps break by id, deterministically", () => {
  const a = { id: "11111111-0000-0000-0000-000000000000", created_at: "2025-05-05T00:00:00Z" };
  const b = { id: "22222222-0000-0000-0000-000000000000", created_at: "2025-05-05T00:00:00Z" };
  assertEquals(pickSurvivorId(a, b), a.id);
  assertEquals(pickSurvivorId(b, a), a.id);
});

Deno.test("both missing created_at breaks by id", () => {
  const a = { id: "11111111-0000-0000-0000-000000000000", created_at: null };
  const b = { id: "22222222-0000-0000-0000-000000000000", created_at: undefined };
  assertEquals(pickSurvivorId(a, b), a.id);
  assertEquals(pickSurvivorId(b, a), a.id);
});
