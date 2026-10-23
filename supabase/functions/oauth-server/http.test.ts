import * as policy from './oauthPolicy.ts';
let source=await Deno.readTextFile(new URL('./index.ts',import.meta.url));
source=source.replace(/^import .*;\n/gm,'').replace(/function makeServiceClient\(\) \{[\s\S]*?\n\}/,'function makeServiceClient(){return (globalThis as any).__oauthClient;}').replace('Deno.serve(async (req) => {','export const handle = (async (req:Request) => {');
(globalThis as any).__oauthPolicy=policy;
source='const {OAUTH_SCOPES,DEFAULT_OAUTH_SCOPE,validOAuthScope,validOAuthLogin,validCodeVerifier,validRedirectUri}=(globalThis as any).__oauthPolicy;\n'+source;
const {handle}=await import(`data:application/typescript;base64,${btoa(unescape(encodeURIComponent(source)))}`);
function assert(v:unknown){if(!v)throw new Error('Assertion failed');}
const rpcCalls:Array<{name:string,args:any}>=[];
(globalThis as any).__oauthClient={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{redirect_uris:['https://client.test/cb'],token_endpoint_auth_method:'none'}})})})}),auth:{getUser:async()=>({data:{user:{id:'confirmed-user'}}})},rpc:async(name:string,args:any)=>{rpcCalls.push({name,args});if(name==='finish_mcp_oauth_login')return {error:{message:'wrong email binding'}};return {data:{scopes:['read']}};}};
Deno.test('HTTP tampered login cannot start a session',async()=>{
 const params={client_id:'client',redirect_uri:'https://evil.test',scope:'read',code_challenge:'a'.repeat(43),code_challenge_method:'S256'};
 const res=await handle(new Request('https://nuke.ag/oauth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'user@example.test',oauth_params:encodeURIComponent(JSON.stringify(params))})}));
 assert((await res.text()).includes('Invalid OAuth client'));assert(rpcCalls.length===0);
});
Deno.test('HTTP callback delegates actual auth user to atomic bound-session writer',async()=>{
 const res=await handle(new Request('https://nuke.ag/oauth/callback-finish',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://nuke.ag'},body:new URLSearchParams({session:'session',access_token:'fixture',consent:'approve'})}));
 assert(rpcCalls.at(-1)?.name==='finish_mcp_oauth_login');assert(rpcCalls.at(-1)?.args.p_user_id==='confirmed-user');assert((await res.text()).includes('Invalid, expired, or completed'));
});
Deno.test('HTTP exchange returns opaque credentials and refresh rejects legacy JWT',async()=>{
 const res=await handle(new Request('https://nuke.ag/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'client',redirect_uri:'https://client.test/cb',code:'code',code_verifier:'a'.repeat(43)})}));
 const body=await res.json();assert(/^nuke_oauth_[a-f0-9]{64}$/.test(body.access_token));assert(rpcCalls.at(-1)?.args.p_access_hash.startsWith('sha256_'));
 const bad=await handle(new Request('https://nuke.ag/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:'client',refresh_token:'old.jwt'})}));assert(bad.status===400);
});

Deno.test('fragment bridge submits credentials in body and receives JSON redirect without fetch navigation',async()=>{
 const mock=(globalThis as any).__oauthClient;
 mock.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{session_id:'session',expires_at:new Date(Date.now()+60000).toISOString()}})})})});
 const page=await handle(new Request('https://nuke.ag/oauth/callback?session=session'));
 assert(page.headers.get('x-frame-options')==='DENY');assert(page.headers.get('referrer-policy')==='no-referrer');
 const html=await page.text();assert(html.includes('history.replaceState'));assert(html.includes('body: params.toString()'));assert(!html.includes('callback-finish?'));assert(!html.includes('innerHTML'));assert(html.includes('Approve these permissions'));assert(html.includes("addEventListener('click'"));
 const previous=mock.rpc;
 mock.rpc=async()=>({data:{redirect_uri:'http://localhost:8123/callback',state:'fixture-state',client_id:'client'}});
 const response=await handle(new Request('https://nuke.ag/oauth/callback-finish',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://nuke.ag'},body:new URLSearchParams({session:'session',access_token:'fixture',consent:'approve'})}));
 assert(response.status===200 && response.headers.get('location')===null);
 const redirect=new URL((await response.json()).redirect);assert(redirect.origin==='http://localhost:8123' && redirect.searchParams.get('state')==='fixture-state' && !!redirect.searchParams.get('code'));
 const rejected=await handle(new Request('https://nuke.ag/oauth/callback-finish?session=session&access_token=fixture',{method:'POST'}));assert(rejected.status===400);
 mock.rpc=previous;
});

Deno.test('magic-link authentication alone never grants client consent',async()=>{
 const before=rpcCalls.length;
 const response=await handle(new Request('https://nuke.ag/oauth/callback-finish',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://nuke.ag'},body:new URLSearchParams({session:'session',access_token:'fixture'})}));
 assert(response.status===403);assert(rpcCalls.length===before);
});
