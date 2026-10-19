// Request bodies and state for claiming a business (claim_organization) and reading its on_nuke state.
import { obj, str, type JsonObject } from '../jobs/jobRead';

export const DOCUMENT_TYPES = ['business_license', 'tax_id', 'articles_incorporation', 'dba_certificate', 'lease_agreement', 'utility_bill'];

export function claimArgs(organizationId: string, method: string, docType: string, docUrl: string):
  { ok: true; args: { p_organization_id: string; p_method: string; p_evidence: JsonObject | null } } | { ok: false; error: string } {
  if (method === 'domain_email') return { ok: true, args: { p_organization_id: organizationId, p_method: method, p_evidence: null } };
  if (method !== 'document') return { ok: false, error: 'Pick how you will prove the business is yours.' };
  if (!DOCUMENT_TYPES.includes(docType)) return { ok: false, error: 'Pick the kind of document.' };
  let url: URL | null = null;
  try { url = new URL(docUrl.trim()); } catch { url = null; }
  if (!url || url.protocol !== 'https:') return { ok: false, error: 'Link the document with an https address.' };
  return { ok: true, args: { p_organization_id: organizationId, p_method: method, p_evidence: { verification_type: docType, document_url: url.toString() } } };
}

/** The claim state line and buttons an organization page shows, from on_nuke. */
export function onNukeClaim(read: JsonObject | null): { claimable: boolean; label: string | null; claim: JsonObject | null } {
  const on = obj(read?.on_nuke);
  return { claimable: on?.state === 'not_on_nuke_yet' && !!obj(on?.claim), label: str(on?.label), claim: obj(on?.claim) };
}
