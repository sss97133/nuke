/**
 * Reply to Inbound Email
 *
 * Sends a reply via Resend and updates the contact_inbox record.
 * Called from the admin inbox UI. The work is in handler.ts; only the service key or an active admin may send.
 */

import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { handleReplyEmail } from "./handler.ts";

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  return handleReplyEmail(req);
});
