#!/usr/bin/env node
// Process Craigslist listing queue items

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, '../nuke_frontend/.env.local') })
config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

async function processQueue(batchSize = 50) {
  console.log(`⚡ Processing Craigslist queue (batch size: ${batchSize})...\n`)

  const { data, error } = await supabase.functions.invoke('process-cl-queue', {
    body: {
      batch_size: batchSize,
    },
  })

  if (error) {
    console.error('❌ Error:', error)
    if (error.context) {
      console.error('Response status:', error.context.status)
      const text = await error.context.text().catch(() => '')
      if (text) console.error('Response body:', text)
    }
    return null
  }

  console.log('✅ Processing Results:\n')
  console.log(JSON.stringify(data, null, 2))
  return data
}

async function main() {
  const args = process.argv.slice(2)
  const batchSize = parseInt(args[0]) || 50

  await processQueue(batchSize)
}

main().catch(console.error)

