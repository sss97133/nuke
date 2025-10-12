import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY env vars to run integration tests')
}

async function signIn(client: SupabaseClient, email: string, password: string) {
  const { data: sess, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !sess.session) throw new Error('Sign in failed')
  return sess.user
}

const OWNER_EMAIL = process.env.SUPABASE_OWNER_EMAIL
const OWNER_PASSWORD = process.env.SUPABASE_OWNER_PASSWORD
const INVITEE_EMAIL = process.env.SUPABASE_INVITEE_EMAIL
const INVITEE_PASSWORD = process.env.SUPABASE_INVITEE_PASSWORD
const RUN = !!(OWNER_EMAIL && OWNER_PASSWORD && INVITEE_EMAIL && INVITEE_PASSWORD)

;(RUN ? describe : describe.skip)('Invitations (remote)', () => {
  let ownerClient: SupabaseClient
  let inviteeClient: SupabaseClient
  let ownerId: string
  let inviteeEmail: string
  let shopId: string

  beforeAll(async () => {
    ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    inviteeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    inviteeEmail = INVITEE_EMAIL!
    const owner = await signIn(ownerClient, OWNER_EMAIL!, OWNER_PASSWORD!)
    await signIn(inviteeClient, INVITEE_EMAIL!, INVITEE_PASSWORD!)
    ownerId = owner.id

    // Create a shop as owner
    const { data: shop, error: shopErr } = await ownerClient
      .from('shops')
      .insert({ name: `Invite Shop ${Date.now()}`, owner_user_id: ownerId } as any)
      .select('id')
      .single()
    if (shopErr) throw new Error(`Shop create failed: ${shopErr.message}`)
    shopId = shop!.id
  }, 30000)

  it('owner can insert an invitation and read it; invitee cannot read it directly', async () => {
    const token = crypto.randomUUID()
    // Owner inserts invitation
    const { error: invErr } = await ownerClient
      .from('shop_invitations')
      .insert({ shop_id: shopId, email: inviteeEmail, role: 'staff', invited_by: ownerId, token, status: 'pending' } as any)
    expect(invErr).toBeNull()

    // Owner can read it
    const { data: invs, error: selErr } = await ownerClient
      .from('shop_invitations')
      .select('id, email, role, status')
      .eq('shop_id', shopId)
    expect(selErr).toBeNull()
    expect((invs || []).some(i => i.email === inviteeEmail)).toBe(true)

    // Invitee should not be able to list invites (policy is owner/admin)
    const { data: invs2, error: selErr2, status } = await inviteeClient
      .from('shop_invitations')
      .select('id')
      .eq('shop_id', shopId)
    // Either RLS returns empty array or error; both are acceptable as not visible
    expect(selErr2 == null ? (invs2 || []).length === 0 : true).toBe(true)
  }, 20000)
})


