#!/usr/bin/env node
// Test SBX Cars queue processing

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

async function checkQueueStatus() {
  console.log('🔍 Checking SBX Cars queue status...\n')

  // Get SBX Cars source
  const { data: sourceData, error: sourceError } = await supabase
    .from('scrape_sources')
    .select('id, name, url')
    .ilike('url', '%sbxcars%')
    .maybeSingle()

  if (sourceError) {
    console.error('❌ Error fetching source:', sourceError)
    return
  }

  if (!sourceData) {
    console.log('⚠️  No SBX Cars source found. Run discovery first.')
    return
  }

  console.log(`✅ Found source: ${sourceData.name} (${sourceData.url})`)
  console.log(`   Source ID: ${sourceData.id}\n`)

  // Check queue status for this source
  const { data: queueItems, error: queueError } = await supabase
    .from('import_queue')
    .select('id, listing_url, status, created_at, attempts')
    .eq('source_id', sourceData.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (queueError) {
    console.error('❌ Error fetching queue:', queueError)
    return
  }

  // Count by status
  const { count: pendingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('source_id', sourceData.id)
    .eq('status', 'pending')

  const { count: processingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('source_id', sourceData.id)
    .eq('status', 'processing')

  const { count: completeCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('source_id', sourceData.id)
    .eq('status', 'complete')

  const { count: failedCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('source_id', sourceData.id)
    .eq('status', 'failed')

  console.log('📊 Queue Status:')
  console.log(`   Pending: ${pendingCount || 0}`)
  console.log(`   Processing: ${processingCount || 0}`)
  console.log(`   Complete: ${completeCount || 0}`)
  console.log(`   Failed: ${failedCount || 0}`)
  console.log(`   Total items: ${queueItems?.length || 0}`)
  console.log('')

  if (queueItems && queueItems.length > 0) {
    console.log('📋 Recent queue items:')
    queueItems.slice(0, 10).forEach((item, idx) => {
      console.log(`   ${idx + 1}. [${item.status}] ${item.listing_url.substring(0, 60)}...`)
    })
    console.log('')
  }

  return {
    sourceId: sourceData.id,
    pendingCount: pendingCount || 0,
    queueItems: queueItems || [],
  }
}

async function processQueue(batchSize = 10) {
  console.log(`⚡ Processing import queue (batch size: ${batchSize})...\n`)

  const { data, error } = await supabase.functions.invoke('process-import-queue', {
    body: {
      batch_size: batchSize,
      priority_only: false,
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
  const shouldProcess = args.includes('--process')

  // Check queue status
  const status = await checkQueueStatus()

  if (!status) {
    process.exit(1)
  }

  if (shouldProcess && status.pendingCount > 0) {
    console.log('')
    await processQueue(10)
  } else if (shouldProcess) {
    console.log('\n⚠️  No pending items to process.')
  } else {
    console.log('\n💡 To process the queue, run with --process flag')
  }
}

main().catch(console.error)


