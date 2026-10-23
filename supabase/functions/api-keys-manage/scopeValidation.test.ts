import { validateSelfServiceScopes } from "./scopeValidation.ts";
function equal(a: unknown,b: unknown) { if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error("Mismatch"); }
Deno.test("normal defaults and documented scope options remain",()=>{
 equal(validateSelfServiceScopes(undefined),["read","write"]);
 for(const scope of ["read","write","stage_write","write:observations","mcp:tools","accounting:correct","accounting:correct","accounting:read","events:read:all","events:write:all","events:read:vehicle:6F07C219593","events:write:vehicle:1G8ZK5275XZ123456"]) equal(validateSelfServiceScopes([scope]),[scope]);
 equal(validateSelfServiceScopes(["read","read"]),["read"]);
});
Deno.test("privileged unknown and malformed scopes cannot be self-issued",()=>{
 for(const input of [["admin"],["write:canonical"],["read","admin"],["receipts:admin"],["events:admin:all"],["events:write:vehicle:*"],["events:write:vehicle: "],["events:write:all:extra"],[" events:read:all"],[{}],[null],null,"write",[],Array(101).fill("read")]) {
  let failed=false;try{validateSelfServiceScopes(input);}catch{failed=true;}if(!failed)throw new Error(`Accepted invalid scope input: ${JSON.stringify(input)}`);
 }
});
