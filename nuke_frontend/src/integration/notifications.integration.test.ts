import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY env vars to run integration tests')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const TEST_EMAIL = process.env.SUPABASE_TEST_EMAIL
const TEST_PASSWORD = process.env.SUPABASE_TEST_PASSWORD
const RUN = !!(TEST_EMAIL && TEST_PASSWORD)

;(RUN ? describe : describe.skip)('user_notifications integration', () => {
  let userId: string

  beforeAll(async () => {
    const { data: sess, error } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL!, password: TEST_PASSWORD! })
    if (error || !sess.session) throw new Error('Sign in failed')
    userId = sess.user.id
  }, 20000)

  it('creates, reads, and marks a notification as read', async () => {
    // Insert
    const { error: insErr } = await supabase.from('user_notifications').insert({
      user_id: userId,
      type: 'system',
      title: 'Integration Notice',
      message: 'Hello from integration test',
      metadata: { src: 'vitest' }
    } as any)
    expect(insErr).toBeNull()

    // Read unread
    const { data: rows, error: selErr } = await supabase
      .from('user_notifications')
      .select('id, is_read')
      .eq('user_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(1)
    expect(selErr).toBeNull()
    expect(rows && rows.length > 0).toBe(true)

    const notifId = rows![0].id as string

    // Mark read
    const { error: upErr } = await supabase
      .from('user_notifications')
      .update({ is_read: true } as any)
      .eq('id', notifId)
      .eq('user_id', userId)
    expect(upErr).toBeNull()

    // Verify read
    const { data: rows2, error: selErr2 } = await supabase
      .from('user_notifications')
      .select('id, is_read')
      .eq('id', notifId)
      .single()
    expect(selErr2).toBeNull()
    expect(rows2?.is_read).toBe(true)
  }, 20000)
})


