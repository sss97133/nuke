#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { DuplicateDetectionWorker } from './duplicate-detection-worker.js'
import dotenv from 'dotenv'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ES module compatibility
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

class MailboxBackfillTool {
  private duplicateWorker: DuplicateDetectionWorker

  constructor() {
    this.duplicateWorker = new DuplicateDetectionWorker()
  }

  async createMissingMailboxes() {
    console.log('🔍 Finding vehicles without mailboxes...')

    // Get all vehicles first
    const { data: allVehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, vin, owner_id, created_at')

    if (vehiclesError) {
      throw vehiclesError
    }

    // Get all existing mailboxes
    const { data: existingMailboxes, error: mailboxError } = await supabase
      .from('vehicle_mailboxes')
      .select('vehicle_id')

    if (mailboxError) {
      throw mailboxError
    }

    // Find vehicles without mailboxes
    const existingVehicleIds = new Set(existingMailboxes?.map(m => m.vehicle_id) || [])
    const vehicles = allVehicles?.filter(v => !existingVehicleIds.has(v.id)) || []

    if (!vehicles || vehicles.length === 0) {
      console.log('✅ All vehicles already have mailboxes')
      return 0
    }

    console.log(`📫 Creating mailboxes for ${vehicles.length} vehicles`)

    let created = 0
    let errors = 0

    for (const vehicle of vehicles) {
      try {
        // Create mailbox
        const { error: mailboxError } = await supabase
          .from('vehicle_mailboxes')
          .insert({
            vehicle_id: vehicle.id,
            vin: vehicle.vin
          })

        if (mailboxError) {
          console.error(`❌ Failed to create mailbox for vehicle ${vehicle.id}:`, mailboxError.message)
          errors++
          continue
        }

        // Grant owner access if there's an owner
        if (vehicle.owner_id) {
          const { data: mailbox } = await supabase
            .from('vehicle_mailboxes')
            .select('id')
            .eq('vehicle_id', vehicle.id)
            .single()

          if (mailbox) {
            await supabase
              .from('mailbox_access_keys')
              .insert({
                mailbox_id: mailbox.id,
                user_id: vehicle.owner_id,
                key_type: 'master',
                permission_level: 'read_write',
                relationship_type: 'owner',
                granted_by: vehicle.owner_id
              })
          }
        }

        created++

        if (created % 100 === 0) {
          console.log(`📫 Created ${created} mailboxes so far...`)
        }
      } catch (error) {
        console.error(`❌ Error creating mailbox for vehicle ${vehicle.id}:`, error)
        errors++
      }
    }

    console.log(`✅ Mailbox creation complete: ${created} created, ${errors} errors`)
    return created
  }

  async processExistingVehicles(batchSize = 50, delayMs = 1000) {
    console.log('🔍 Processing existing vehicles for duplicate detection...')

    // Get all vehicles that have images but no recent duplicate detection jobs
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select(`
        id,
        vin,
        created_at,
        images:vehicle_images(count)
      `)
      .gt('images.count', 0) // Only vehicles with images
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    if (!vehicles || vehicles.length === 0) {
      console.log('❌ No vehicles with images found')
      return
    }

    console.log(`🔍 Found ${vehicles.length} vehicles with images`)

    // Filter out vehicles that already have recent duplicate detection jobs
    const vehiclesNeedingProcessing = []

    for (const vehicle of vehicles) {
      const { data: existingJobs } = await supabase
        .from('duplicate_detection_jobs')
        .select('id, status, created_at')
        .eq('vehicle_id', vehicle.id)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days
        .limit(1)

      if (!existingJobs || existingJobs.length === 0) {
        vehiclesNeedingProcessing.push(vehicle)
      }
    }

    console.log(`🔍 ${vehiclesNeedingProcessing.length} vehicles need duplicate detection processing`)

    if (vehiclesNeedingProcessing.length === 0) {
      return
    }

    // Process in batches
    let processed = 0
    let errors = 0

    for (let i = 0; i < vehiclesNeedingProcessing.length; i += batchSize) {
      const batch = vehiclesNeedingProcessing.slice(i, i + batchSize)
      console.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vehiclesNeedingProcessing.length / batchSize)}`)

      try {
        const results = await this.duplicateWorker.processBatch(
          batch.map(v => v.id)
        )

        processed += results.successful
        errors += results.failed

        console.log(`📊 Batch complete: ${results.successful} successful, ${results.failed} failed`)

        // Delay between batches to avoid overloading
        if (i + batchSize < vehiclesNeedingProcessing.length && delayMs > 0) {
          console.log(`⏸️  Waiting ${delayMs}ms before next batch...`)
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      } catch (error) {
        console.error(`❌ Batch processing error:`, error)
        errors += batch.length
      }
    }

    console.log(`✅ Processing complete: ${processed} successful, ${errors} errors`)
  }

  async generateStats() {
    console.log('📊 Generating mailbox system statistics...')

    // Vehicle mailbox stats
    const { data: mailboxStats } = await supabase
      .from('vehicle_mailboxes')
      .select('id', { count: 'exact' })

    // Access key stats
    const { data: accessKeyStats } = await supabase
      .from('mailbox_access_keys')
      .select('key_type, permission_level, relationship_type')

    // Message stats
    const { data: messageStats } = await supabase
      .from('mailbox_messages')
      .select('message_type, priority, resolved_at')

    // Duplicate detection stats
    const { data: duplicateStats } = await supabase
      .from('duplicate_detections')
      .select('detection_method, confidence_score, status')

    // Job queue stats
    const jobStats = await this.duplicateWorker.getJobStats()

    console.log('\n📊 Mailbox System Statistics:')
    console.log('==============================')

    console.log(`\n📫 Mailboxes: ${mailboxStats?.length || 0}`)

    if (accessKeyStats?.length) {
      console.log('\n🔑 Access Keys by Type:')
      const keyTypeStats = accessKeyStats.reduce((acc: any, key: any) => {
        acc[key.key_type] = (acc[key.key_type] || 0) + 1
        return acc
      }, {})
      console.table(keyTypeStats)

      console.log('\n🔐 Access Keys by Relationship:')
      const relationshipStats = accessKeyStats.reduce((acc: any, key: any) => {
        acc[key.relationship_type] = (acc[key.relationship_type] || 0) + 1
        return acc
      }, {})
      console.table(relationshipStats)
    }

    if (messageStats?.length) {
      console.log(`\n✉️  Total Messages: ${messageStats.length}`)

      const messageTypeStats = messageStats.reduce((acc: any, msg: any) => {
        acc[msg.message_type] = (acc[msg.message_type] || 0) + 1
        return acc
      }, {})
      console.table(messageTypeStats)

      const resolvedCount = messageStats.filter((msg: any) => msg.resolved_at).length
      console.log(`\n✅ Resolved Messages: ${resolvedCount}/${messageStats.length}`)
    }

    if (duplicateStats?.length) {
      console.log(`\n🔍 Duplicate Detections: ${duplicateStats.length}`)

      const methodStats = duplicateStats.reduce((acc: any, dup: any) => {
        acc[dup.detection_method] = (acc[dup.detection_method] || 0) + 1
        return acc
      }, {})
      console.table(methodStats)

      const confidenceRanges = duplicateStats.reduce((acc: any, dup: any) => {
        const confidence = parseFloat(dup.confidence_score)
        let range = 'Unknown'
        if (confidence >= 0.9) range = '90-100%'
        else if (confidence >= 0.7) range = '70-89%'
        else if (confidence >= 0.5) range = '50-69%'
        else range = '<50%'

        acc[range] = (acc[range] || 0) + 1
        return acc
      }, {})
      console.log('\n📈 Confidence Score Distribution:')
      console.table(confidenceRanges)
    }

    if (jobStats.total > 0) {
      console.log('\n⚙️  Job Queue:')
      console.table(jobStats)
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  const tool = new MailboxBackfillTool()

  switch (command) {
    case 'create-mailboxes':
      // Create missing mailboxes for existing vehicles
      const created = await tool.createMissingMailboxes()
      console.log(`🎉 Created ${created} mailboxes`)
      break

    case 'process-existing':
      // Process existing vehicles for duplicate detection
      const batchSize = parseInt(args[1]) || 50
      const delay = parseInt(args[2]) || 1000
      await tool.processExistingVehicles(batchSize, delay)
      break

    case 'stats':
      // Generate comprehensive statistics
      await tool.generateStats()
      break

    case 'full-backfill':
      // Complete backfill process
      console.log('🚀 Starting full mailbox system backfill...')

      console.log('\n1️⃣  Creating missing mailboxes...')
      await tool.createMissingMailboxes()

      console.log('\n2️⃣  Processing existing vehicles...')
      await tool.processExistingVehicles()

      console.log('\n3️⃣  Generating statistics...')
      await tool.generateStats()

      console.log('\n🎉 Full backfill complete!')
      break

    default:
      console.log('Vehicle Mailbox Backfill Tool')
      console.log('')
      console.log('Commands:')
      console.log('  create-mailboxes                    - Create missing mailboxes for existing vehicles')
      console.log('  process-existing [batch] [delay]    - Process existing vehicles for duplicate detection')
      console.log('  stats                               - Generate system statistics')
      console.log('  full-backfill                       - Run complete backfill process')
      console.log('')
      console.log('Examples:')
      console.log('  npm run backfill-mailboxes create-mailboxes')
      console.log('  npm run backfill-mailboxes process-existing 100 2000')
      console.log('  npm run backfill-mailboxes stats')
      console.log('  npm run backfill-mailboxes full-backfill')
      process.exit(1)
  }
}

// ES module equivalent of require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { MailboxBackfillTool }