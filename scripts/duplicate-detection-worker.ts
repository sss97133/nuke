#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { VehicleDuplicateDetector } from './detect-vehicle-duplicates.js'
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

interface DuplicateDetectionJob {
  job_id: string
  vehicle_id: string
  priority: string
  scheduled_at: string
  retry_count: number
}

class DuplicateDetectionWorker {
  private detector: VehicleDuplicateDetector
  private isRunning = false
  private pollInterval = 10000 // 10 seconds

  constructor() {
    this.detector = new VehicleDuplicateDetector()
  }

  async start() {
    console.log('🚀 Starting duplicate detection worker...')
    this.isRunning = true

    // Initial retry of failed jobs
    await this.retryFailedJobs()

    // Main processing loop
    while (this.isRunning) {
      try {
        await this.processJobs()
        await this.sleep(this.pollInterval)
      } catch (error) {
        console.error('❌ Error in worker loop:', error)
        await this.sleep(this.pollInterval)
      }
    }
  }

  async stop() {
    console.log('⏹️  Stopping duplicate detection worker...')
    this.isRunning = false
  }

  private async processJobs() {
    // Get pending jobs from the queue
    const { data: jobs, error } = await supabase.rpc('get_pending_duplicate_detection_jobs', {
      limit_count: 5
    })

    if (error) {
      console.error('Failed to get pending jobs:', error)
      return
    }

    if (!jobs || jobs.length === 0) {
      return // No jobs to process
    }

    console.log(`📋 Found ${jobs.length} pending jobs`)

    // Process jobs concurrently
    const promises = jobs.map((job: DuplicateDetectionJob) => this.processJob(job))
    await Promise.allSettled(promises)
  }

  private async processJob(job: DuplicateDetectionJob) {
    console.log(`🔍 Processing duplicate detection job for vehicle: ${job.vehicle_id}`)

    try {
      // Call the PostgreSQL function to process the job
      const { data, error } = await supabase.rpc('process_duplicate_detection_job', {
        job_id: job.job_id
      })

      if (error) {
        throw error
      }

      if (data === true) {
        console.log(`✅ Successfully processed job: ${job.job_id}`)
      } else {
        console.log(`⚠️  Job processing returned false: ${job.job_id}`)
      }
    } catch (error) {
      console.error(`❌ Failed to process job ${job.job_id}:`, error)

      // The PostgreSQL function handles error logging and retry logic
      // so we don't need to do additional error handling here
    }
  }

  private async retryFailedJobs() {
    try {
      const { data: retryCount, error } = await supabase.rpc('retry_failed_duplicate_detection_jobs')

      if (error) {
        console.error('Failed to retry failed jobs:', error)
        return
      }

      if (retryCount > 0) {
        console.log(`🔄 Retried ${retryCount} failed jobs`)
      }
    } catch (error) {
      console.error('Error retrying failed jobs:', error)
    }
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Manual job processing for specific vehicles
  async processVehicle(vehicleId: string, highPriority = false) {
    console.log(`🔍 Processing vehicle manually: ${vehicleId}`)

    try {
      // Create a manual job
      const { data: job, error } = await supabase
        .from('duplicate_detection_jobs')
        .insert({
          vehicle_id: vehicleId,
          status: 'pending',
          priority: highPriority ? 'urgent' : 'high',
          scheduled_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) {
        throw error
      }

      // Process immediately
      await this.processJob({
        job_id: job.id,
        vehicle_id: vehicleId,
        priority: job.priority,
        scheduled_at: job.scheduled_at,
        retry_count: 0
      })

      console.log(`✅ Manual processing completed for vehicle: ${vehicleId}`)
    } catch (error) {
      console.error(`❌ Failed manual processing for vehicle ${vehicleId}:`, error)
      throw error
    }
  }

  // Batch process multiple vehicles
  async processBatch(vehicleIds: string[]) {
    console.log(`🔍 Processing batch of ${vehicleIds.length} vehicles`)

    const promises = vehicleIds.map(vehicleId => this.processVehicle(vehicleId))
    const results = await Promise.allSettled(promises)

    const successful = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length

    console.log(`📊 Batch processing complete: ${successful} successful, ${failed} failed`)

    return { successful, failed, results }
  }

  // Get job statistics
  async getJobStats() {
    const { data: stats, error } = await supabase
      .from('duplicate_detection_jobs')
      .select('status, priority')

    if (error) {
      throw error
    }

    const summary = stats.reduce((acc: any, job: any) => {
      acc[job.status] = (acc[job.status] || 0) + 1
      acc.total = (acc.total || 0) + 1
      return acc
    }, {})

    return summary
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  const worker = new DuplicateDetectionWorker()

  switch (command) {
    case 'start':
      // Start the continuous worker
      process.on('SIGINT', async () => {
        await worker.stop()
        process.exit(0)
      })

      await worker.start()
      break

    case 'process':
      // Process a specific vehicle
      const vehicleId = args[1]
      if (!vehicleId) {
        console.error('Usage: duplicate-detection-worker.ts process <vehicle_id>')
        process.exit(1)
      }
      await worker.processVehicle(vehicleId, true)
      break

    case 'batch':
      // Process multiple vehicles from a file or argument list
      const vehicleIds = args.slice(1)
      if (vehicleIds.length === 0) {
        console.error('Usage: duplicate-detection-worker.ts batch <vehicle_id1> <vehicle_id2> ...')
        process.exit(1)
      }
      await worker.processBatch(vehicleIds)
      break

    case 'stats':
      // Show job statistics
      const stats = await worker.getJobStats()
      console.log('📊 Job Statistics:')
      console.table(stats)
      break

    case 'retry':
      // Retry failed jobs
      const { data: retryCount, error } = await supabase.rpc('retry_failed_duplicate_detection_jobs')
      if (error) {
        console.error('Failed to retry jobs:', error)
        process.exit(1)
      }
      console.log(`🔄 Retried ${retryCount} failed jobs`)
      break

    default:
      console.log('Duplicate Detection Worker')
      console.log('')
      console.log('Commands:')
      console.log('  start                           - Start the continuous worker daemon')
      console.log('  process <vehicle_id>            - Process a specific vehicle immediately')
      console.log('  batch <vehicle_id1> <id2> ...   - Process multiple vehicles')
      console.log('  stats                           - Show job statistics')
      console.log('  retry                           - Retry failed jobs')
      console.log('')
      console.log('Examples:')
      console.log('  npm run duplicate-worker start')
      console.log('  npm run duplicate-worker process 12345678-1234-1234-1234-123456789abc')
      console.log('  npm run duplicate-worker batch vehicle1 vehicle2 vehicle3')
      process.exit(1)
  }
}

// ES module equivalent of require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { DuplicateDetectionWorker }