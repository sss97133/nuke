export const OAUTH_SCOPES = ["read","write","stage_write","write:observations","mcp:tools","receipts:read","receipts:upload","receipts:submit","events:read","events:write","events:read:all","events:write:all"];
export const DEFAULT_OAUTH_SCOPE = "read write:observations receipts:read receipts:upload receipts:submit";
export function validOAuthScope(scope: unknown): scope is string {
 return typeof scope === "string" && scope.length>0 && scope.length<1000 && scope.split(/\s+/).every(s=>OAUTH_SCOPES.includes(s));
}
export function validOAuthLogin(params: Record<string,string>, client: {redirect_uris?: string[];token_endpoint_auth_method?:string}|null): boolean {
 return !!client && client.token_endpoint_auth_method === "none" && !!client.redirect_uris?.includes(params.redirect_uri) && params.code_challenge_method === "S256" && /^[A-Za-z0-9_-]{43}$/.test(params.code_challenge??"") && validOAuthScope(params.scope);
}
export function validCodeVerifier(value: unknown): value is string { return typeof value==="string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value); }
export function isOpaqueOAuthToken(value: string): boolean { return /^nuke_oauth_[a-f0-9]{64}$/.test(value); }
export function validRedirectUri(value: string): boolean {
 try {const u=new URL(value);return !u.hash && !u.username && !u.password && (u.protocol==='https:' || (u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)));}catch{return false;}
}
