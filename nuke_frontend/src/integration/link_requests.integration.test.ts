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
const MEMBER_EMAIL = process.env.SUPABASE_MEMBER_EMAIL
const MEMBER_PASSWORD = process.env.SUPABASE_MEMBER_PASSWORD
const RUN = !!(OWNER_EMAIL && OWNER_PASSWORD && MEMBER_EMAIL && MEMBER_PASSWORD)

;(RUN ? describe : describe.skip)('Vehicle Link Requests (remote)', () => {
  let ownerClient: SupabaseClient
  let memberClient: SupabaseClient
  let ownerId: string
  let memberId: string
  let shopId: string
  let vehicleId: string

  beforeAll(async () => {
    ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    memberClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    const owner = await signIn(ownerClient, OWNER_EMAIL!, OWNER_PASSWORD!)
    const member = await signIn(memberClient, MEMBER_EMAIL!, MEMBER_PASSWORD!)
    ownerId = owner.id
    memberId = member.id

    // Create shop as owner
    const { data: shop, error: shopErr } = await ownerClient
      .from('shops')
      .insert({ name: `Link Shop ${Date.now()}`, owner_user_id: ownerId } as any)
      .select('id')
      .single()
    if (shopErr) throw new Error(`Shop create failed: ${shopErr.message}`)
    shopId = shop!.id

    // Make member a member
    const { error: memErr } = await ownerClient
      .from('shop_members')
      .upsert({ shop_id: shopId, user_id: memberId, role: 'staff', status: 'active' } as any, { onConflict: 'shop_id,user_id' } as any)
    if (memErr) throw new Error(`Member upsert failed: ${memErr.message}`)

    // Create a simple vehicle owned by nobody (public insert allowed by your schema)
    const { data: veh, error: vErr } = await memberClient
      .from('vehicles')
      .insert({ make: 'Test', model: 'Unit', year: 1999, vin: `TESTVIN${Date.now()}`.slice(0,17), uploaded_by: memberId } as any)
      .select('id')
      .single()
    if (vErr) throw new Error(`Vehicle insert failed: ${vErr.message}`)
    vehicleId = veh!.id
  }, 40000)

  it('member can create link request; owner can approve', async () => {
    // Member creates a link request
    const { data: req, error: rErr } = await memberClient
      .from('vehicle_link_requests')
      .insert({ shop_id: shopId, vehicle_id: vehicleId, requested_by: memberId, note: 'Please link' } as any)
      .select('id, status')
      .single()
    expect(rErr).toBeNull()
    expect(req!.status).toBe('pending')

    // Owner approves
    const { error: aErr } = await ownerClient
      .from('vehicle_link_requests')
      .update({ status: 'approved', reviewed_by: ownerId, reviewed_at: new Date().toISOString() } as any)
      .eq('id', req!.id)
    expect(aErr).toBeNull()

    // Verify
    const { data: r2, error: r2Err } = await ownerClient
      .from('vehicle_link_requests')
      .select('status')
      .eq('id', req!.id)
      .single()
    expect(r2Err).toBeNull()
    expect(r2!.status).toBe('approved')
  }, 30000)
})


