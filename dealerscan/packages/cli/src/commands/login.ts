import { Command } from 'commander'
import { initSupabase, getSupabase } from '@dealerscan/shared'
import fs from 'fs'
import path from 'path'
import readline from 'readline'

const AUTH_FILE = path.join(process.env.HOME || '', '.dealerscan', 'auth.json')

function ensureAuthDir() {
  const dir = path.dirname(AUTH_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function loadAuth(): { accessToken: string; refreshToken: string; supabaseUrl: string; supabaseAnonKey: string } | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'))
  } catch {
    return null
  }
}

function saveAuth(data: any) {
  ensureAuthDir()
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export const loginCommand = new Command('login')
  .description('Authenticate with DealerScan')
  .option('--url <url>', 'Supabase URL', 'https://qkgaybvrernstplzjaam.supabase.co')
  .option('--key <key>', 'Supabase anon key')
  .action(async (opts) => {
    const supabaseUrl = opts.url
    const supabaseAnonKey = opts.key || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY4MTYyNjUsImV4cCI6MjA1MjM5MjI2NX0.R4xvnmMeNQJjUOHYbVE4Bq5s8O0wYBWctR4g6bOG1bM'

    initSupabase({ url: supabaseUrl, anonKey: supabaseAnonKey })

    const email = await prompt('Email: ')
    const password = await prompt('Password: ')

    console.log('Signing in...')
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      console.error(`Login failed: ${error.message}`)
      process.exit(1)
    }

    saveAuth({
      accessToken: data.session?.access_token,
      refreshToken: data.session?.refresh_token,
      supabaseUrl,
      supabaseAnonKey,
    })

    console.log(`Logged in as ${data.user?.email}`)
    console.log(`Auth saved to ${AUTH_FILE}`)
  })
