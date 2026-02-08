import { Command } from 'commander'
import { initSupabase, getSupabase } from '@dealerscan/shared'
import { loadAuth } from './login'

export const statusCommand = new Command('status')
  .description('Check account status and credits')
  .action(async () => {
    const auth = loadAuth()
    if (!auth) {
      console.error('Not logged in. Run: dealerscan login')
      process.exit(1)
    }

    initSupabase({ url: auth.supabaseUrl, anonKey: auth.supabaseAnonKey })
    const supabase = getSupabase()

    const { error: refreshError } = await supabase.auth.setSession({
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
    })

    if (refreshError) {
      console.error('Session expired. Run: dealerscan login')
      process.exit(1)
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      console.error('Not authenticated')
      process.exit(1)
    }

    console.log(`Account: ${user.email}`)

    // Get credits
    const { data: credits } = await supabase.rpc('ds_get_credits', { p_user_id: user.id })
    if (credits?.[0]) {
      const c = credits[0]
      console.log(`Credits: ${c.total_available} total`)
      console.log(`  Free: ${c.free_remaining}/${c.free_limit}`)
      console.log(`  Paid: ${c.paid_remaining}`)
    }

    // Get deal count
    const { count } = await supabase
      .from('ds_deals')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .neq('status', 'archived')

    console.log(`Active deals: ${count || 0}`)

    // Check Ollama
    try {
      const resp = await fetch('http://localhost:11434/api/tags')
      if (resp.ok) {
        const data = await resp.json()
        const visionModels = (data.models || []).filter((m: any) =>
          ['llava', 'bakllava', 'moondream'].some(v => m.name.includes(v))
        )
        console.log(`Ollama: connected (${visionModels.length} vision models)`)
      } else {
        console.log('Ollama: not running')
      }
    } catch {
      console.log('Ollama: not running')
    }
  })
