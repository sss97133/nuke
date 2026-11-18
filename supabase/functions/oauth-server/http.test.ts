import * as policy from './oauthPolicy.ts';
let source=await Deno.readTextFile(new URL('./index.ts',import.meta.url));
source=source.replace(/^import .*;\n/gm,'').replace(/function makeServiceClient\(\) \{[\s\S]*?\n\}/,'function makeServiceClient(){return (globalThis as any).__oauthClient;}').replace('Deno.serve(async (req) => {','export const handle = (async (req:Request) => {');
(globalThis as any).__oauthPolicy=policy;
source='const projectSecretKey=()=>"test-secret";const {OAUTH_SCOPES,DEFAULT_OAUTH_SCOPE,validOAuthScope,validOAuthLogin,validCodeVerifier,validRedirectUri}=(globalThis as any).__oauthPolicy;\n'+source;
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

Deno.test('password sign-in reaches the approval page in the same browser and sends no email',async()=>{
 const mock=(globalThis as any).__oauthClient;const prevFrom=mock.from,prevAuth=mock.auth;
 const inserted:any[]=[];let emailed=0;let factors:any[]=[];
 mock.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{redirect_uris:['https://client.test/cb'],token_endpoint_auth_method:'none',client_name:'Fixture'}})})}),insert:async(row:any)=>{inserted.push(row);return {error:null};}});
 mock.auth={getUser:prevAuth.getUser,signInWithOtp:async()=>{emailed++;return {error:null};},
  signInWithPassword:async({password}:any)=>password==='right'?{data:{session:{access_token:'aal1-token'}},error:null}:{data:{session:null},error:{message:'bad'}},
  mfa:{listFactors:async()=>({data:{totp:factors},error:null}),challengeAndVerify:async({code}:any)=>code==='123456'?{data:{access_token:'aal2-token'},error:null}:{data:null,error:{message:'bad'}}}};
 const params=encodeURIComponent(JSON.stringify({client_id:'client',redirect_uri:'https://client.test/cb',scope:'read',state:'s',code_challenge:'a'.repeat(43),code_challenge_method:'S256'}));
 const post=(fields:Record<string,string>)=>handle(new Request('https://nuke.ag/oauth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:'user@example.test',oauth_params:params,...fields})}));
 const bad=await post({password:'wrong',method:'password'});assert(bad.status===400);assert(inserted.length===0);
 const ok=await post({password:'right',method:'password'});const html=await ok.text();
 assert(ok.status===200);assert(html.includes('Approve these permissions'));assert(html.includes('"aal1-token"'));assert(inserted.length===1 && inserted[0].state==='s');assert(emailed===0);
 factors=[{id:'f1',status:'verified'}];
 const needs=await post({password:'right',method:'password'});assert(needs.status===400);assert((await needs.text()).includes('authenticator'));assert(inserted.length===1);
 const wrong=await post({password:'right',totp:'000000',method:'password'});assert(wrong.status===400);assert(inserted.length===1);
 const stepped=await post({password:'right',totp:'123456',method:'password'});assert((await stepped.text()).includes('"aal2-token"'));assert(inserted.length===2);
 const link=await post({password:'right',method:'link'});assert((await link.text()).includes('Open it in this same browser'));assert(emailed===1);
 mock.from=prevFrom;mock.auth=prevAuth;
});

Deno.test('two refreshes racing on one token derive the same successor pair',async()=>{
 const mock=(globalThis as any).__oauthClient;const prev=mock.rpc;const seen:any[]=[];
 mock.rpc=async(_:string,args:any)=>{seen.push(args);return {data:{scopes:['read'],replayed:seen.length>1}};};
 const call=(token:string)=>handle(new Request('https://nuke.ag/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:'client',refresh_token:token})})).then((r:Response)=>r.json());
 const old='nuke_refresh_'+'a'.repeat(64);
 const [one,two]=await Promise.all([call(old),call(old)]);const other=await call('nuke_refresh_'+'b'.repeat(64));
 assert(one.access_token===two.access_token && one.refresh_token===two.refresh_token);
 assert(/^nuke_oauth_[a-f0-9]{64}$/.test(one.access_token) && /^nuke_refresh_[a-f0-9]{64}$/.test(one.refresh_token));
 assert(one.refresh_token!==old && other.refresh_token!==one.refresh_token && one.access_token.slice(11)!==one.refresh_token.slice(13));
 assert(seen[0].p_refresh_hash===seen[1].p_refresh_hash && seen[0].p_access_hash===seen[1].p_access_hash);
 mock.rpc=prev;
});

Deno.test('provider and site-session sign-ins stay in the browser and bind only provider sessions',async()=>{
 const mock=(globalThis as any).__oauthClient;const prevFrom=mock.from,prevAuth=mock.auth,prevRpc=mock.rpc;
 const inserted:any[]=[];const updates:any[]=[];
 mock.from=()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{redirect_uris:['https://client.test/cb'],token_endpoint_auth_method:'none',client_name:'Fixture'}})})}),insert:async(row:any)=>{inserted.push(row);return {error:null};},
  update:(v:any)=>{const u:any={v,f:[]};updates.push(u);const c:any={eq:(...a:any[])=>{u.f.push(['eq',...a]);return c;},like:(...a:any[])=>{u.f.push(['like',...a]);return c;},is:(...a:any[])=>{u.f.push(['is',...a]);return c;},then:(r:any)=>r({error:null})};return c;}});
 mock.auth={getUser:async(t:string)=>t==='good'?{data:{user:{id:'u1',email:'Owner@Example.Test'}}}:{data:{user:null}}};
 mock.rpc=async()=>({data:{redirect_uri:'https://client.test/cb',state:'s',client_id:'client'}});
 const params=encodeURIComponent(JSON.stringify({client_id:'client',redirect_uri:'https://client.test/cb',scope:'read',state:'s',code_challenge:'a'.repeat(43),code_challenge_method:'S256'}));
 const post=(fields:Record<string,string>)=>handle(new Request('https://nuke.ag/oauth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({oauth_params:params,...fields})}));
 const g=await post({method:'google'});const loc=new URL(g.headers.get('location')!);
 assert(g.status===302 && loc.pathname==='/auth/v1/authorize' && loc.searchParams.get('provider')==='google');
 assert(loc.searchParams.get('redirect_to')==='https://nuke.ag/oauth/callback?session='+inserted[0].session_id && inserted[0].email==='provider:google');
 const bad=await post({method:'session',access_token:'stale'});assert(bad.status===400 && inserted.length===1);
 const ok=await post({method:'session',access_token:'good'});const html=await ok.text();
 assert(html.includes('Approve these permissions') && html.includes('"good"') && inserted[1].email==='owner@example.test');
 const page=await (await handle(new Request('https://nuke.ag/oauth/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.test%2Fcb&scope=read&code_challenge='+'a'.repeat(43)))).text();
 assert(page.includes('Continue with Google') && page.includes('Continue with Apple') && page.includes('value="session"') && page.includes('-auth-token'));
 const fin=await handle(new Request('https://nuke.ag/oauth/callback-finish',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://nuke.ag'},body:new URLSearchParams({session:'sess',access_token:'good',consent:'approve'})}));
 assert(fin.status===200 && updates.length===1 && updates[0].v.email==='owner@example.test');
 assert(JSON.stringify(updates[0].f)===JSON.stringify([['eq','session_id','sess'],['like','email','provider:%'],['is','completed_at',null]]));
 mock.from=prevFrom;mock.auth=prevAuth;mock.rpc=prevRpc;
});
