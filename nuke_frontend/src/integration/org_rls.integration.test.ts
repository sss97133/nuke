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

;(RUN ? describe : describe.skip)('Organization RLS (remote)', () => {
  let ownerClient: SupabaseClient
  let memberClient: SupabaseClient
  let ownerId: string
  let memberId: string
  let shopId: string

  beforeAll(async () => {
    ownerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    memberClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    const owner = await signIn(ownerClient, OWNER_EMAIL!, OWNER_PASSWORD!)
    ownerId = owner.id
    const member = await signIn(memberClient, MEMBER_EMAIL!, MEMBER_PASSWORD!)
    memberId = member.id

    // Create a shop as owner
    const { data: shop, error: shopErr } = await ownerClient
      .from('shops')
      .insert({ name: `Test Shop ${Date.now()}`, owner_user_id: ownerId } as any)
      .select('id')
      .single()
    if (shopErr) throw new Error(`Shop create failed: ${shopErr.message}`)
    shopId = shop!.id
  }, 30000)

  it('owner can upsert a member and member can read membership', async () => {
    // Owner adds member
    const { error: upErr } = await ownerClient
      .from('shop_members')
      .upsert({ shop_id: shopId, user_id: memberId, role: 'staff', status: 'active' } as any, { onConflict: 'shop_id,user_id' } as any)
    expect(upErr).toBeNull()

    // Member sees their membership
    const { data: rows, error: selErr } = await memberClient
      .from('shop_members')
      .select('id, shop_id, user_id, role, status')
      .eq('shop_id', shopId)
    expect(selErr).toBeNull()
    expect((rows || []).some(r => r.user_id === memberId)).toBe(true)
  }, 20000)

  it('documents: public visible to anyone; shop_members visible to members', async () => {
    // Insert two docs as owner
    const { error: ins1 } = await ownerClient.from('shop_documents').insert({
      shop_id: shopId,
      document_type: 'state_business_license',
      title: 'Public Doc',
      storage_path: 'path/public',
      file_url: 'https://example.com/public.pdf',
      visibility: 'public'
    } as any)
    expect(ins1).toBeNull()

    const { error: ins2 } = await ownerClient.from('shop_documents').insert({
      shop_id: shopId,
      document_type: 'state_business_license',
      title: 'Members Doc',
      storage_path: 'path/members',
      file_url: 'https://example.com/members.pdf',
      visibility: 'shop_members'
    } as any)
    expect(ins2).toBeNull()

    // Member can see both
    const { data: mdocs, error: mErr } = await memberClient
      .from('shop_documents')
      .select('id, title, visibility')
      .eq('shop_id', shopId)
    expect(mErr).toBeNull()
    const titles = (mdocs || []).map(d => d.title)
    expect(titles).toContain('Public Doc')
    expect(titles).toContain('Members Doc')
  }, 30000)
})


