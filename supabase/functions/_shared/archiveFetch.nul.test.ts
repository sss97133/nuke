import { stripNul } from "./archiveFetch.ts";

Deno.test("NUL characters are removed before a capture is stored, other text is untouched", () => {
  if (stripNul("a\u0000b\u0000") !== "ab") throw new Error("NUL kept");
  if (stripNul("<html>é</html>") !== "<html>é</html>") throw new Error("text changed");
  if (stripNul(null) !== null || stripNul(undefined) !== null) throw new Error("null handling");
});
