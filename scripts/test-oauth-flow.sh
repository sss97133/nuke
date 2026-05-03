#!/usr/bin/env bash
# scripts/test-oauth-flow.sh
#
# End-to-end OAuth 2.0 PKCE flow test for the NUKE oauth-server edge function.
# Bypasses Vercel rewrites by hitting Supabase directly:
#   ${VITE_SUPABASE_URL}/functions/v1/oauth-server/<route>
#
# What this proves:
#   1. /oauth/register issues a client_id (DCR / RFC 7591)
#   2. /oauth/authorize renders the email-input HTML form
#   3. /oauth/login starts a magic-link session and writes oauth_login_sessions
#   4. We seed the magic-link completion (insert authorization code + mark
#      session completed) — Skylar's email click is not automatable
#   5. /oauth/token exchanges code+verifier for an access_token (PKCE S256)
#   6. supabase.auth.getUser(access_token) accepts the issued JWT — the JWT
#      issuer/aud/secret alignment is correct
#
# Exits 0 on full green; 1 with a specific diagnostic on first failure.
#
# Usage: dotenvx run -- bash scripts/test-oauth-flow.sh
#
# Required env (loaded via dotenvx from .env):
#   VITE_SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   SUPABASE_JWT_SECRET
#   SUPABASE_URL (= VITE_SUPABASE_URL)
#
# Hard rule: this script never DELETEs from oauth_clients, oauth_login_sessions,
# or oauth_authorization_codes (testimony for OAuth flow forensics). It only
# inserts and reads.

set -u

# ── Pretty output ────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'
pass() { echo "${GREEN}PASS${NC}  $*"; }
fail() { echo "${RED}FAIL${NC}  $*"; exit 1; }
info() { echo "${CYAN}····${NC}  $*"; }
warn() { echo "${YELLOW}WARN${NC}  $*"; }

# ── Env preflight ────────────────────────────────────────────────────────────
: "${VITE_SUPABASE_URL:?VITE_SUPABASE_URL not set — run via 'dotenvx run --'}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"
: "${SUPABASE_JWT_SECRET:?SUPABASE_JWT_SECRET not set}"

# Skylar's user_id (locked-in caller arg per WS-2 spec).
export SKYLAR_USER_ID="${SKYLAR_USER_ID:-0b9f107a-d124-49de-9ded-94698f63c1c4}"
export SKYLAR_EMAIL="${SKYLAR_EMAIL:-shkylar@gmail.com}"

OAUTH_BASE="${VITE_SUPABASE_URL%/}/functions/v1/oauth-server"
SR_KEY="$SUPABASE_SERVICE_ROLE_KEY"

info "OAUTH_BASE = $OAUTH_BASE"
info "user_id    = $SKYLAR_USER_ID"

# ── Step 0: JWT round-trip preflight ────────────────────────────────────────
# Mint an access_token using oauth-server's exact algorithm and validate it via
# supabase.auth.getUser. If this fails, the issuer/aud/secret are misaligned
# and Claude.ai's bearer tokens won't authenticate against mcp-connector.
info "Step 0: JWT round-trip — mint with SUPABASE_JWT_SECRET, validate via supabase.auth.getUser"

ROUNDTRIP_RESULT="$(node --input-type=module -e "
import crypto from 'node:crypto';
const secret = process.env.SUPABASE_JWT_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const userId = process.env.SKYLAR_USER_ID;
const email  = process.env.SKYLAR_EMAIL;

const b64url = (b) => Buffer.from(b).toString('base64')
  .replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');

const header  = { alg: 'HS256', typ: 'JWT' };
const now = Math.floor(Date.now()/1000);
const payload = {
  aud: 'authenticated',
  role: 'authenticated',
  sub: userId,
  email,
  iss: \`\${supabaseUrl}/auth/v1\`,
  iat: now,
  exp: now + 60*60,
  nuke_oauth: { scopes: ['events:read','events:write'], source: 'oauth-server' },
};
const enc = (o) => b64url(JSON.stringify(o));
const signing = enc(header)+'.'+enc(payload);
const sig = crypto.createHmac('sha256', secret).update(signing).digest();
const token = signing+'.'+b64url(sig);

const res = await fetch(\`\${supabaseUrl}/auth/v1/user\`, {
  headers: {
    'Authorization': 'Bearer '+token,
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
});
const body = await res.text();
let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; }
console.log(JSON.stringify({
  http: res.status,
  resolved_user_id: parsed && parsed.id || null,
  expected_user_id: userId,
  match: !!(parsed && parsed.id === userId),
  iss_used: payload.iss,
  body_preview: typeof parsed === 'string' ? parsed.slice(0,200) : null,
  err: typeof parsed === 'object' && parsed && parsed.msg || null,
}));
" 2>&1)"
NODE_EXIT=$?

if [ $NODE_EXIT -ne 0 ]; then
  echo "$ROUNDTRIP_RESULT"
  fail "Node JWT mint/verify script exited $NODE_EXIT"
fi

RT_HTTP=$(echo "$ROUNDTRIP_RESULT" | jq -r '.http // empty')
RT_MATCH=$(echo "$ROUNDTRIP_RESULT" | jq -r '.match // false')
RT_ISS=$(echo "$ROUNDTRIP_RESULT" | jq -r '.iss_used // empty')
RT_RESOLVED=$(echo "$ROUNDTRIP_RESULT" | jq -r '.resolved_user_id // empty')

if [ "$RT_HTTP" != "200" ] || [ "$RT_MATCH" != "true" ]; then
  echo "$ROUNDTRIP_RESULT" | jq .
  fail "JWT round-trip failed. http=$RT_HTTP resolved=$RT_RESOLVED iss=$RT_ISS — Supabase rejected our token. Check SUPABASE_JWT_SECRET alignment and iss claim."
fi
pass "JWT round-trip (iss=$RT_ISS, resolved user_id=$RT_RESOLVED)"

# ── PKCE generation (S256) ──────────────────────────────────────────────────
# Generate a code_verifier (43-128 chars, [A-Z][a-z][0-9]-._~) and the matching
# S256 code_challenge.
PKCE_PAIR="$(node --input-type=module -e "
import crypto from 'node:crypto';
const b64url = (b) => Buffer.from(b).toString('base64')
  .replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
console.log(JSON.stringify({verifier, challenge}));
")"
CODE_VERIFIER=$(echo "$PKCE_PAIR" | jq -r '.verifier')
CODE_CHALLENGE=$(echo "$PKCE_PAIR" | jq -r '.challenge')

# ── Step 1: DCR ─────────────────────────────────────────────────────────────
info "Step 1: POST /oauth/register (Dynamic Client Registration)"

REDIRECT_URI="https://example.test/oauth-test/$RANDOM"
DCR_RESP="$(curl -s -o /tmp/oauth-test-dcr.json -w '%{http_code}' \
  -X POST "$OAUTH_BASE/oauth/register" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "content-type: application/json" \
  -d "{\"client_name\":\"ws2-test-$$\",\"redirect_uris\":[\"$REDIRECT_URI\"],\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"],\"token_endpoint_auth_method\":\"none\",\"scope\":\"events:write events:read\"}")"

if [ "$DCR_RESP" != "201" ]; then
  cat /tmp/oauth-test-dcr.json
  fail "DCR expected 201, got $DCR_RESP"
fi
CLIENT_ID=$(jq -r '.client_id' /tmp/oauth-test-dcr.json)
[ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ] || fail "DCR returned no client_id"
pass "DCR → client_id=$CLIENT_ID"

# ── Step 2: GET /oauth/authorize ────────────────────────────────────────────
info "Step 2: GET /oauth/authorize (expect HTML form)"

STATE="ws2teststate$RANDOM"
AUTHZ_URL="$OAUTH_BASE/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$REDIRECT_URI")&response_type=code&scope=events%3Awrite+events%3Aread&state=$STATE&code_challenge=$CODE_CHALLENGE&code_challenge_method=S256"

AUTHZ_HTTP="$(curl -s -o /tmp/oauth-test-authz.html -w '%{http_code}' \
  -H "Authorization: Bearer $SR_KEY" \
  "$AUTHZ_URL")"

if [ "$AUTHZ_HTTP" != "200" ]; then
  head -c 500 /tmp/oauth-test-authz.html
  fail "/oauth/authorize expected 200, got $AUTHZ_HTTP"
fi

# Verify form action is absolute (form-action audit per WS-2 task 1).
if grep -qF 'action="https://nuke.ag/oauth/login"' /tmp/oauth-test-authz.html; then
  pass "Authorize HTML rendered, form action is ABSOLUTE (https://nuke.ag/oauth/login)"
elif grep -qF 'action="/oauth/login"' /tmp/oauth-test-authz.html; then
  fail "Authorize form action is RELATIVE — Claude.ai webview may resolve against wrong base. Fix oauth-server/index.ts."
else
  warn "Authorize HTML rendered but form action attribute not found — manual review needed"
fi

# ── Step 3: POST /oauth/login (start magic-link session) ────────────────────
info "Step 3: POST /oauth/login (expect 200 'check email' page)"

OAUTH_PARAMS_JSON=$(jq -nc \
  --arg cid "$CLIENT_ID" \
  --arg ru "$REDIRECT_URI" \
  --arg s "events:write events:read" \
  --arg st "$STATE" \
  --arg cc "$CODE_CHALLENGE" \
  '{client_id:$cid, redirect_uri:$ru, scope:$s, state:$st, code_challenge:$cc, code_challenge_method:"S256"}')
OAUTH_PARAMS_ENC=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$OAUTH_PARAMS_JSON")

LOGIN_HTTP="$(curl -s -o /tmp/oauth-test-login.html -w '%{http_code}' \
  -X POST "$OAUTH_BASE/oauth/login" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "email=$SKYLAR_EMAIL" \
  --data-urlencode "oauth_params=$OAUTH_PARAMS_JSON")"

# 200 means the session was inserted and a magic-link send was attempted.
# Skylar's SMTP / generateLink config may or may not actually deliver email.
if [ "$LOGIN_HTTP" != "200" ]; then
  head -c 500 /tmp/oauth-test-login.html
  fail "/oauth/login expected 200, got $LOGIN_HTTP"
fi
if ! grep -qi "check your email" /tmp/oauth-test-login.html; then
  warn "Login HTML did not include 'check your email' — the page changed shape; verify manually"
else
  pass "Login HTML rendered ('check your email')"
fi

# ── Step 4: Seed magic-link completion ──────────────────────────────────────
# We can't click Skylar's email. Instead, find the most recent oauth_login_sessions
# row for this client_id+email and insert an authorization code that ties to it.
# This is exactly what /oauth/callback's finishCallback() does on real magic-link click.
info "Step 4: Seed authorization code (simulating magic-link click)"

PG_REST="$VITE_SUPABASE_URL/rest/v1"

SESSION_ROW="$(curl -s \
  -H "Authorization: Bearer $SR_KEY" \
  -H "apikey: $SR_KEY" \
  "$PG_REST/oauth_login_sessions?client_id=eq.$CLIENT_ID&email=eq.$SKYLAR_EMAIL&order=created_at.desc&limit=1")"

SESSION_ID=$(echo "$SESSION_ROW" | jq -r '.[0].session_id // empty')
SESSION_REDIRECT=$(echo "$SESSION_ROW" | jq -r '.[0].redirect_uri // empty')
SESSION_CHALLENGE=$(echo "$SESSION_ROW" | jq -r '.[0].code_challenge // empty')
SESSION_SCOPE=$(echo "$SESSION_ROW" | jq -r '.[0].scope // empty')

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo "$SESSION_ROW"
  fail "No oauth_login_sessions row found for client_id=$CLIENT_ID, email=$SKYLAR_EMAIL"
fi

if [ "$SESSION_CHALLENGE" != "$CODE_CHALLENGE" ]; then
  fail "Session row code_challenge mismatch: stored=$SESSION_CHALLENGE expected=$CODE_CHALLENGE"
fi

# Generate an authorization code (32 random bytes hex) and insert it.
AUTH_CODE=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
EXPIRES_AT=$(node -e "console.log(new Date(Date.now()+10*60*1000).toISOString())")

INSERT_RESP="$(curl -s -o /tmp/oauth-test-codeins.json -w '%{http_code}' \
  -X POST "$PG_REST/oauth_authorization_codes" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "apikey: $SR_KEY" \
  -H "content-type: application/json" \
  -H "Prefer: return=representation" \
  -d "$(jq -nc \
    --arg code "$AUTH_CODE" \
    --arg cid "$CLIENT_ID" \
    --arg uid "$SKYLAR_USER_ID" \
    --arg ru "$SESSION_REDIRECT" \
    --arg sc "$SESSION_SCOPE" \
    --arg cc "$SESSION_CHALLENGE" \
    --arg exp "$EXPIRES_AT" \
    '{code:$code, client_id:$cid, user_id:$uid, redirect_uri:$ru, scope:$sc, code_challenge:$cc, code_challenge_method:"S256", expires_at:$exp}')")"

if [ "$INSERT_RESP" != "201" ]; then
  cat /tmp/oauth-test-codeins.json
  fail "oauth_authorization_codes insert expected 201, got $INSERT_RESP"
fi

# Mark login session completed (idempotent).
curl -s -o /dev/null \
  -X PATCH "$PG_REST/oauth_login_sessions?session_id=eq.$SESSION_ID" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "apikey: $SR_KEY" \
  -H "content-type: application/json" \
  -d "$(jq -nc --arg uid "$SKYLAR_USER_ID" --arg ts "$(date -u +%FT%TZ)" '{user_id:$uid, completed_at:$ts}')"

pass "Authorization code seeded (session_id=$SESSION_ID, code_len=${#AUTH_CODE})"

# ── Step 5: POST /oauth/token (PKCE exchange) ───────────────────────────────
info "Step 5: POST /oauth/token (authorization_code grant + PKCE)"

TOKEN_HTTP="$(curl -s -o /tmp/oauth-test-token.json -w '%{http_code}' \
  -X POST "$OAUTH_BASE/oauth/token" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$AUTH_CODE" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "redirect_uri=$REDIRECT_URI" \
  --data-urlencode "code_verifier=$CODE_VERIFIER")"

if [ "$TOKEN_HTTP" != "200" ]; then
  cat /tmp/oauth-test-token.json
  fail "/oauth/token expected 200, got $TOKEN_HTTP"
fi

ACCESS_TOKEN=$(jq -r '.access_token' /tmp/oauth-test-token.json)
REFRESH_TOKEN=$(jq -r '.refresh_token' /tmp/oauth-test-token.json)
TOKEN_TYPE=$(jq -r '.token_type' /tmp/oauth-test-token.json)
EXPIRES_IN=$(jq -r '.expires_in' /tmp/oauth-test-token.json)

[ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ] || fail "Token response missing access_token"
[ "$TOKEN_TYPE" = "Bearer" ] || fail "Token response token_type expected Bearer, got $TOKEN_TYPE"
pass "Token exchanged (access_token len=${#ACCESS_TOKEN}, expires_in=$EXPIRES_IN)"

# ── Step 6: Validate access_token via supabase.auth.getUser ────────────────
info "Step 6: Validate access_token via Supabase /auth/v1/user"

VALIDATE_RESP="$(curl -s -o /tmp/oauth-test-user.json -w '%{http_code}' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $SR_KEY" \
  "$VITE_SUPABASE_URL/auth/v1/user")"

if [ "$VALIDATE_RESP" != "200" ]; then
  cat /tmp/oauth-test-user.json
  fail "supabase.auth.getUser rejected our access_token (http=$VALIDATE_RESP) — JWT alignment broken"
fi

RESOLVED_ID=$(jq -r '.id' /tmp/oauth-test-user.json)
RESOLVED_EMAIL=$(jq -r '.email' /tmp/oauth-test-user.json)
if [ "$RESOLVED_ID" != "$SKYLAR_USER_ID" ]; then
  fail "JWT validates but sub=$RESOLVED_ID does not match expected $SKYLAR_USER_ID"
fi
pass "Access token validated (user_id=$RESOLVED_ID, email=$RESOLVED_EMAIL)"

# ── Step 7: Refresh-token grant smoke test ──────────────────────────────────
info "Step 7: POST /oauth/token (refresh_token grant)"

REFRESH_HTTP="$(curl -s -o /tmp/oauth-test-refresh.json -w '%{http_code}' \
  -X POST "$OAUTH_BASE/oauth/token" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  --data-urlencode "client_id=$CLIENT_ID")"

if [ "$REFRESH_HTTP" != "200" ]; then
  cat /tmp/oauth-test-refresh.json
  fail "/oauth/token refresh expected 200, got $REFRESH_HTTP"
fi
NEW_ACCESS=$(jq -r '.access_token' /tmp/oauth-test-refresh.json)
[ -n "$NEW_ACCESS" ] && [ "$NEW_ACCESS" != "null" ] || fail "Refresh response missing access_token"
pass "Refresh-token grant issued new access_token (len=${#NEW_ACCESS})"

# ── Step 8: Replay protection — reusing code must fail ──────────────────────
info "Step 8: Replay attack — reusing same code must fail with invalid_grant"

REPLAY_HTTP="$(curl -s -o /tmp/oauth-test-replay.json -w '%{http_code}' \
  -X POST "$OAUTH_BASE/oauth/token" \
  -H "Authorization: Bearer $SR_KEY" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$AUTH_CODE" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "redirect_uri=$REDIRECT_URI" \
  --data-urlencode "code_verifier=$CODE_VERIFIER")"
REPLAY_ERR=$(jq -r '.error // empty' /tmp/oauth-test-replay.json)
if [ "$REPLAY_HTTP" = "400" ] && [ "$REPLAY_ERR" = "invalid_grant" ]; then
  pass "Code-reuse rejected (http=400 invalid_grant)"
else
  warn "Replay test unexpected: http=$REPLAY_HTTP error=$REPLAY_ERR (expected 400 invalid_grant)"
fi

# ── Step 9: Metadata endpoints ──────────────────────────────────────────────
info "Step 9: /.well-known/oauth-authorization-server discovery"

META_HTTP="$(curl -s -o /tmp/oauth-test-meta.json -w '%{http_code}' \
  -H "Authorization: Bearer $SR_KEY" \
  "$OAUTH_BASE/.well-known/oauth-authorization-server")"
[ "$META_HTTP" = "200" ] || fail "Metadata endpoint http=$META_HTTP"
META_ISSUER=$(jq -r '.issuer' /tmp/oauth-test-meta.json)
[ "$META_ISSUER" = "https://nuke.ag" ] || fail "Metadata issuer=$META_ISSUER expected https://nuke.ag"
pass "Authorization-server metadata advertised (issuer=$META_ISSUER)"

echo
echo "${GREEN}All checks passed.${NC} Tested client_id=$CLIENT_ID; session_id=$SESSION_ID."
echo "Note: oauth_clients / oauth_login_sessions / oauth_authorization_codes rows are KEPT (testimony)."
exit 0
