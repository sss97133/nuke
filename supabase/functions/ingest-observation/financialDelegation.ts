import { ingestFinancialEvidence, FINANCIAL_EVIDENCE_MODE } from './financialEvidence.ts';

type Caller = { kind: string; userId?: string | null; keyId?: string | null; agentId?: string | null; scopes?: string[] };
type Database = Parameters<typeof ingestFinancialEvidence>[0];
const denied = () => ({ status: 403, body: { error: 'Active accounting access required' } });
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
/** Actor and credential come only from verified authentication, never request JSON. */
export async function delegatedFinancialEvidence(db: Database, caller: Caller, input: unknown, reauthenticate: () => Promise<Caller | null>) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return denied();
  const body = input as Record<string, any>;
  const action = body.action;
  if (!['contexts','read','tax_read','correct','original'].includes(action) || !['user','api_key'].includes(caller.kind) || !caller.userId) return denied();
  const operation = action === 'correct' ? 'correct' : 'read';
  if (caller.kind === 'api_key' && !caller.keyId) return denied();
  if (caller.kind === 'api_key' && !caller.scopes?.includes(`accounting:${operation}`)) return { status: 403, body: { error: 'insufficient_scope', required_scope: `accounting:${operation}`, message: 'Reconnect with this explicit scope and approve the requested permissions.' } };
  const actor = caller.userId, key = caller.kind === 'api_key' ? caller.keyId! : null;
  const owner = action === 'contexts' ? actor : body.owner_user_id;
  if (!uuid(owner)) return denied();
  let authority: Record<string, unknown> | null = null;
  const check = async () => {
    const current = await reauthenticate();
    if (!current || current.kind !== caller.kind || current.userId !== actor || (current.kind === 'api_key' && (current.keyId !== key || !current.scopes?.includes(`accounting:${operation}`)))) return false;
    const result = await db.rpc('authorize_financial_access', { p_actor_id: actor, p_owner_id: owner, p_key_id: key, p_operation: operation });
    if (result.error || !(result.data as any)?.allowed) return false;
    authority = result.data as Record<string, unknown>;
    return true;
  };
  if (!await check()) return denied();
  if (action === 'contexts') {
    if (Object.keys(body).some(k => !['mode','action'].includes(k))) return denied();
    const result = await db.rpc('read_financial_access_context', { p_actor_id: actor, p_key_id: key });
    if (result.error || !await check()) return denied();
    return { status: 200, body: { data: result.data } };
  }
  if (action === 'original') {
    if (!uuid(body.document_id) || Object.keys(body).some(k => !['mode','action','owner_user_id','document_id'].includes(k))) return denied();
    const result = await db.rpc('read_financial_evidence', { p_owner_id: owner, p_document_id: body.document_id, p_sha256: null });
    const doc = (result.data as any)?.document;
    if (result.error || !doc || doc.owner_id !== owner || typeof doc.storage_path !== 'string' || !doc.storage_path.startsWith(`${owner}/`) || doc.storage_path.includes('..') || doc.storage_path.includes('\\')) return denied();
    const bucket = await db.storage.getBucket('user-documents');
    if (bucket.error || bucket.data?.public !== false) return denied();
    const held = await db.storage.from('user-documents').download(doc.storage_path);
    if (held.error || !held.data || held.data.size < 1 || held.data.size > 10485760) return denied();
    const bytes = new Uint8Array(await held.data.arrayBuffer());
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
    if (hash !== doc.content_sha256 || !await check()) return denied();
    let binary = ''; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    return { status: 200, body: { data: { document_id: doc.id, source_filename: doc.source_filename, sha256: hash, mime_type: held.data.type, bytes_base64: btoa(binary) } } };
  }
  const { owner_user_id: _owner, ...request } = body;
  if (action === 'correct') {
    if (!uuid(body.revision?.supersedes_run_id)) return { status: 400, body: { error: 'Correction requires the current revision' } };
    request.action = 'submit';
  }
  const result = await ingestFinancialEvidence(db, owner, { ...request, mode: FINANCIAL_EVIDENCE_MODE }, check,
    { kind: caller.kind, agent_id: caller.agentId, actor_user_id: actor, owner_user_id: owner, key_id: key, grant_id: authority!['grant_id'] });
  return await check() ? result : denied();
}
