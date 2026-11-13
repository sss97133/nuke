import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requestedVin } from "./vinRequest.ts";

Deno.test("GET names the VIN in the path", () => {
  assertEquals(requestedVin("GET", "/functions/v1/api-v1-vin-lookup/2S87D3N143591", null), "2S87D3N143591");
  assertEquals(requestedVin("GET", "/functions/v1/api-v1-vin-lookup", null), null);
});

Deno.test("POST names the VIN in the JSON body, as the MCP decode_vin tool sends it", () => {
  assertEquals(requestedVin("POST", "/functions/v1/api-v1-vin-lookup", { vin: " 2S87D3N143591 " }), "2S87D3N143591");
  assertEquals(requestedVin("POST", "/functions/v1/api-v1-vin-lookup", {}), null);
  assertEquals(requestedVin("POST", "/functions/v1/api-v1-vin-lookup", null), null);
  assertEquals(requestedVin("POST", "/functions/v1/api-v1-vin-lookup", { vin: 123 }), null);
});
