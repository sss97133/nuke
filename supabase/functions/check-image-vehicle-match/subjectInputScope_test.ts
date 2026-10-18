import { allowedSubjectSources, subjectInputScopeRefusal } from "./subjectInputScope.ts";
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = "a".repeat(64);
function equal(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("subject input scope contract differs"); }

Deno.test("allowed-source scope is optional and an exact bounded UUID to SHA map", () => {
  const absent = allowedSubjectSources(undefined, [id(1)]);
  equal(absent, { valid: true, hashes: null });
  equal(subjectInputScopeRefusal(null, [{ id: id(2), file_hash: hash }]), null);
  const maximum = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [id(i + 1), hash]));
  const parsed = allowedSubjectSources(maximum, [id(1)], { [id(1)]: hash });
  equal(parsed.valid, true);
  if (parsed.valid) equal(parsed.hashes?.size, 64);
  equal(allowedSubjectSources({ ...maximum, [id(65)]: hash }, [id(1)]).valid, false);
});

Deno.test("malformed maps, omitted fresh IDs and disagreement with existing pins are rejected", () => {
  for (const value of [null, [], "invalid", {}, { nope: hash }, { [id(1)]: hash.toUpperCase() },
    { [id(1)]: "a".repeat(63) }, { [id(1)]: 1 }, { [id(2)]: hash }]) {
    equal(allowedSubjectSources(value, [id(1)]).valid, false);
  }
  equal(allowedSubjectSources({ [id(1)]: hash }, [id(1)], { [id(1)]: "b".repeat(64) }).valid, false);
});

Deno.test("the scope snapshots exact byte pins and distinguishes outside context from changed bytes", () => {
  const body = { [id(1)]: hash }, parsed = allowedSubjectSources(body, [id(1)]);
  if (!parsed.valid) throw new Error("fixture scope invalid");
  body[id(1)] = "b".repeat(64); body[id(2)] = hash;
  equal(subjectInputScopeRefusal(parsed.hashes, [{ id: id(1), file_hash: hash }]), null);
  equal(subjectInputScopeRefusal(parsed.hashes, [{ id: id(1), file_hash: "b".repeat(64) }]), "source_changed");
  equal(subjectInputScopeRefusal(parsed.hashes, [{ id: id(2), file_hash: hash }]), "source_outside_allowed_scope");
});
