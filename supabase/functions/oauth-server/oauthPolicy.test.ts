import {validOAuthLogin,validOAuthScope,validCodeVerifier,validRedirectUri,DEFAULT_OAUTH_SCOPE} from './oauthPolicy.ts';
function assert(v:unknown){if(!v)throw new Error('Assertion failed');}
Deno.test('OAuth scope ceiling and PKCE/client binding',()=>{
 const p={redirect_uri:'https://client.test/cb',scope:DEFAULT_OAUTH_SCOPE,code_challenge:'a'.repeat(43),code_challenge_method:'S256'};
 const c={redirect_uris:[p.redirect_uri],token_endpoint_auth_method:'none'};
 assert(validOAuthLogin(p,c));assert(!validOAuthLogin({...p,redirect_uri:'https://evil.test'},c));assert(!validOAuthLogin({...p,code_challenge_method:'plain'},c));assert(!validOAuthLogin({...p,code_challenge:''},c));
 for(const s of ['admin','write:canonical','read admin','receipts:admin',''])assert(!validOAuthScope(s));
 assert(validCodeVerifier('a'.repeat(43)));assert(!validCodeVerifier('short'));
});

Deno.test('redirects permit HTTPS and terminal loopback only',()=>{
 for(const u of ['https://client.test/cb','http://localhost:123/cb','http://127.0.0.1:456/cb','http://[::1]:789/cb'])assert(validRedirectUri(u));
 for(const u of ['javascript:alert(1)','data:text/html,test','http://evil.test/cb','https://client.test/cb#fragment','https://user:pass@client.test/cb'])assert(!validRedirectUri(u));
});
