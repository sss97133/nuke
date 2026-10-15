import { postFromFlight } from "./rscPost.ts";

const lot = { __typename: "Lot", title: "1941 Cadillac \"Series\" 61 {Coupe}", vinSerial: "5363001", hammerPrice: "27000" };
const chunk = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;

Deno.test("reads the lot object across flight chunks, with braces and quotes inside strings", () => {
  const text = `5:{"a":1,"post":${JSON.stringify(lot)},"isLandingPage":false}`;
  const html = chunk(text.slice(0, 40)) + chunk(text.slice(40));
  const post = postFromFlight(html);
  if (post?.vinSerial !== "5363001" || post?.title !== lot.title) throw new Error(`got ${JSON.stringify(post)}`);
});

Deno.test("a page with no lot object is null", () => {
  if (postFromFlight(chunk('1:{"post":{"__typename":"Page"}}')) !== null) throw new Error("expected null");
  if (postFromFlight("<html></html>") !== null) throw new Error("expected null");
});
