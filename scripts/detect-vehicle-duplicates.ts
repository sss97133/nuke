#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import exifr from 'exifr'
import crypto from 'crypto'
import dotenv from 'dotenv'

// ES module compatibility
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface ImageForensics {
  id?: string
  vehicle_id: string
  image_url: string
  exif_data: any
  gps_coordinates?: string
  timestamp_taken?: Date
  device_fingerprint?: string
  perceptual_hash: string
  ai_features?: any
}

interface DuplicateMatch {
  original_vehicle_id: string
  duplicate_vehicle_id: string
  confidence_score: number
  detection_method: string
  evidence: any
}

class VehicleDuplicateDetector {
  private async extractImageForensics(imageUrl: string, vehicleId: string): Promise<ImageForensics> {
    try {
      // Download and extract EXIF data
      const response = await fetch(imageUrl)
      const buffer = Buffer.from(await response.arrayBuffer())

      // Extract EXIF data using exifr
      const exifData = await exifr.parse(buffer, {
        gps: true,
        exif: true,
        iptc: true,
        icc: true
      })

      // Create device fingerprint from camera/device specific data
      const deviceFingerprint = this.createDeviceFingerprint(exifData)

      // Generate perceptual hash (simple implementation - could use more sophisticated algorithms)
      const perceptualHash = this.generatePerceptualHash(buffer)

      // Extract GPS coordinates if available
      let gpsCoordinates: string | undefined
      let timestampTaken: Date | undefined

      if (exifData?.latitude && exifData?.longitude) {
        gpsCoordinates = `POINT(${exifData.longitude} ${exifData.latitude})`
      }

      // Extract timestamp from EXIF
      if (exifData?.DateTimeOriginal) {
        timestampTaken = new Date(exifData.DateTimeOriginal)
      } else if (exifData?.CreateDate) {
        timestampTaken = new Date(exifData.CreateDate)
      } else if (exifData?.ModifyDate) {
        timestampTaken = new Date(exifData.ModifyDate)
      }

      return {
        vehicle_id: vehicleId,
        image_url: imageUrl,
        exif_data: exifData,
        gps_coordinates: gpsCoordinates,
        timestamp_taken: timestampTaken,
        device_fingerprint: deviceFingerprint,
        perceptual_hash: perceptualHash,
        ai_features: await this.extractAIFeatures(buffer, exifData)
      }
    } catch (error) {
      console.error(`Failed to extract forensics from ${imageUrl}:`, error)
      throw error
    }
  }

  private createDeviceFingerprint(exifData: any): string {
    // Create a unique fingerprint from device-specific EXIF data
    const fingerprintData = {
      make: exifData?.Make,
      model: exifData?.Model,
      software: exifData?.Software,
      lens_make: exifData?.LensMake,
      lens_model: exifData?.LensModel,
      camera_serial: exifData?.CameraSerial,
      lens_serial: exifData?.LensSerial
    }

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(fingerprintData))
      .digest('hex')
      .substring(0, 16)
  }

  private generatePerceptualHash(imageBuffer: Buffer): string {
    // Simple hash based on file content (in production, use proper perceptual hashing)
    return crypto
      .createHash('md5')
      .update(imageBuffer)
      .digest('hex')
  }

  private async extractAIFeatures(imageBuffer: Buffer, exifData: any): Promise<any> {
    // Placeholder for AI feature extraction
    // In production, this would use OpenAI Vision API or similar to extract:
    // - Vehicle make/model/color
    // - Damage patterns
    // - Unique identifiers (license plates, etc.)
    // - Environmental context (background, lighting)

    return {
      extracted_at: new Date().toISOString(),
      method: 'placeholder',
      features: {
        // These would be real AI-extracted features
        dominant_colors: ['#ffffff', '#000000'],
        detected_objects: ['vehicle'],
        scene_context: 'parking lot',
        lighting_conditions: 'daylight'
      }
    }
  }

  async processVehicleImages(vehicleId: string): Promise<void> {
    console.log(`Processing images for vehicle: ${vehicleId}`)

    // Get all images for this vehicle
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .eq('vehicle_id', vehicleId)

    if (error) {
      console.error('Failed to fetch vehicle images:', error)
      return
    }

    if (!images || images.length === 0) {
      console.log('No images found for vehicle')
      return
    }

    for (const image of images) {
      try {
        const forensics = await this.extractImageForensics(image.image_url, vehicleId)

        // Save to database
        const { error: insertError } = await supabase
          .from('image_forensics')
          .insert(forensics)

        if (insertError) {
          console.error(`Failed to save forensics for image ${image.id}:`, insertError)
        } else {
          console.log(`✓ Processed image: ${image.id}`)
        }
      } catch (error) {
        console.error(`Failed to process image ${image.id}:`, error)
        continue
      }
    }
  }

  async detectDuplicates(vehicleId: string): Promise<DuplicateMatch[]> {
    console.log(`Detecting duplicates for vehicle: ${vehicleId}`)

    const matches: DuplicateMatch[] = []

    // Method 1: GPS + Timestamp correlation (highest confidence)
    const gpsMatches = await this.findGPSMatches(vehicleId)
    matches.push(...gpsMatches)

    // Method 2: Perceptual hash matching (medium confidence)
    const hashMatches = await this.findHashMatches(vehicleId)
    matches.push(...hashMatches)

    // Method 3: Device fingerprint matching (medium confidence)
    const deviceMatches = await this.findDeviceMatches(vehicleId)
    matches.push(...deviceMatches)

    // Method 4: Temporal clustering (lower confidence)
    const temporalMatches = await this.findTemporalMatches(vehicleId)
    matches.push(...temporalMatches)

    // Remove duplicates and sort by confidence
    return this.deduplicateMatches(matches)
  }

  private async findGPSMatches(vehicleId: string): Promise<DuplicateMatch[]> {
    const { data, error } = await supabase.rpc('detect_vehicle_duplicates', {
      target_vehicle_id: vehicleId
    })

    if (error) {
      console.error('GPS matching failed:', error)
      return []
    }

    return (data || [])
      .filter((match: any) => match.method === 'exif_gps')
      .map((match: any) => ({
        original_vehicle_id: vehicleId,
        duplicate_vehicle_id: match.duplicate_id,
        confidence_score: parseFloat(match.confidence),
        detection_method: 'exif_gps',
        evidence: match.evidence
      }))
  }

  private async findHashMatches(vehicleId: string): Promise<DuplicateMatch[]> {
    // Find vehicles with identical perceptual hashes
    const { data: currentHashes } = await supabase
      .from('image_forensics')
      .select('perceptual_hash')
      .eq('vehicle_id', vehicleId)

    if (!currentHashes?.length) return []

    const hashes = currentHashes.map(h => h.perceptual_hash)

    const { data: matches } = await supabase
      .from('image_forensics')
      .select('vehicle_id, perceptual_hash')
      .in('perceptual_hash', hashes)
      .neq('vehicle_id', vehicleId)

    if (!matches?.length) return []

    return matches.map(match => ({
      original_vehicle_id: vehicleId,
      duplicate_vehicle_id: match.vehicle_id,
      confidence_score: 0.75,
      detection_method: 'image_hash',
      evidence: {
        matching_hash: match.perceptual_hash,
        hash_algorithm: 'md5'
      }
    }))
  }

  private async findDeviceMatches(vehicleId: string): Promise<DuplicateMatch[]> {
    // Find vehicles photographed with the same device
    const { data: currentDevices } = await supabase
      .from('image_forensics')
      .select('device_fingerprint, timestamp_taken')
      .eq('vehicle_id', vehicleId)
      .not('device_fingerprint', 'is', null)

    if (!currentDevices?.length) return []

    const matches: DuplicateMatch[] = []

    for (const device of currentDevices) {
      const { data: deviceMatches } = await supabase
        .from('image_forensics')
        .select('vehicle_id, timestamp_taken')
        .eq('device_fingerprint', device.device_fingerprint)
        .neq('vehicle_id', vehicleId)

      if (deviceMatches?.length) {
        for (const match of deviceMatches) {
          // Higher confidence if photos taken close in time
          const timeDiff = Math.abs(
            new Date(device.timestamp_taken).getTime() -
            new Date(match.timestamp_taken).getTime()
          ) / (1000 * 60 * 60) // Hours

          const confidence = timeDiff < 24 ? 0.70 : 0.50

          matches.push({
            original_vehicle_id: vehicleId,
            duplicate_vehicle_id: match.vehicle_id,
            confidence_score: confidence,
            detection_method: 'device_fingerprint',
            evidence: {
              device_fingerprint: device.device_fingerprint,
              time_difference_hours: timeDiff
            }
          })
        }
      }
    }

    return matches
  }

  private async findTemporalMatches(vehicleId: string): Promise<DuplicateMatch[]> {
    // Find vehicles with photos taken in similar time periods
    const { data: timeRanges } = await supabase
      .from('image_forensics')
      .select('timestamp_taken')
      .eq('vehicle_id', vehicleId)
      .not('timestamp_taken', 'is', null)

    if (!timeRanges?.length) return []

    const matches: DuplicateMatch[] = []

    for (const timeRange of timeRanges) {
      const baseTime = new Date(timeRange.timestamp_taken)
      const startTime = new Date(baseTime.getTime() - (2 * 60 * 60 * 1000)) // -2 hours
      const endTime = new Date(baseTime.getTime() + (2 * 60 * 60 * 1000))   // +2 hours

      const { data: temporalMatches } = await supabase
        .from('image_forensics')
        .select('vehicle_id, timestamp_taken')
        .neq('vehicle_id', vehicleId)
        .gte('timestamp_taken', startTime.toISOString())
        .lte('timestamp_taken', endTime.toISOString())

      if (temporalMatches?.length) {
        for (const match of temporalMatches) {
          matches.push({
            original_vehicle_id: vehicleId,
            duplicate_vehicle_id: match.vehicle_id,
            confidence_score: 0.30,
            detection_method: 'temporal_clustering',
            evidence: {
              time_window_hours: 4,
              match_timestamp: match.timestamp_taken
            }
          })
        }
      }
    }

    return matches
  }

  private deduplicateMatches(matches: DuplicateMatch[]): DuplicateMatch[] {
    const uniqueMatches = new Map<string, DuplicateMatch>()

    for (const match of matches) {
      const key = `${match.original_vehicle_id}-${match.duplicate_vehicle_id}`
      const existing = uniqueMatches.get(key)

      if (!existing || match.confidence_score > existing.confidence_score) {
        uniqueMatches.set(key, match)
      }
    }

    return Array.from(uniqueMatches.values())
      .sort((a, b) => b.confidence_score - a.confidence_score)
  }

  async processDuplicateDetection(vehicleId: string): Promise<void> {
    try {
      // Step 1: Process all images for forensic analysis
      await this.processVehicleImages(vehicleId)

      // Step 2: Detect duplicates using multiple methods
      const matches = await this.detectDuplicates(vehicleId)

      console.log(`Found ${matches.length} potential duplicates`)

      // Step 3: Save duplicate detection results
      for (const match of matches) {
        const { error } = await supabase
          .from('duplicate_detections')
          .upsert({
            original_vehicle_id: match.original_vehicle_id,
            duplicate_vehicle_id: match.duplicate_vehicle_id,
            detection_method: match.detection_method,
            confidence_score: match.confidence_score,
            evidence: match.evidence,
            status: 'pending'
          }, { onConflict: 'original_vehicle_id,duplicate_vehicle_id' })

        if (error) {
          console.error('Failed to save duplicate detection:', error)
          continue
        }

        // Step 4: Send notification if confidence is high enough
        if (match.confidence_score >= 0.7) {
          await this.sendDuplicateNotification(match)
        }

        console.log(`✓ Detected duplicate: ${match.duplicate_vehicle_id} (${(match.confidence_score * 100).toFixed(0)}% confidence)`)
      }
    } catch (error) {
      console.error(`Failed to process duplicate detection for vehicle ${vehicleId}:`, error)
    }
  }

  private async sendDuplicateNotification(match: DuplicateMatch): Promise<void> {
    const { error } = await supabase.rpc('notify_duplicate_detection', {
      original_vehicle_id: match.original_vehicle_id,
      duplicate_vehicle_id: match.duplicate_vehicle_id,
      confidence_score: match.confidence_score,
      evidence_data: match.evidence
    })

    if (error) {
      console.error('Failed to send duplicate notification:', error)
    } else {
      console.log(`✓ Sent duplicate notification for vehicle ${match.original_vehicle_id}`)
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  const vehicleId = args[1]

  if (!command || !vehicleId) {
    console.log('Usage: detect-vehicle-duplicates.ts <command> <vehicle_id>')
    console.log('Commands:')
    console.log('  process   - Extract forensics and detect duplicates')
    console.log('  forensics - Extract forensics only')
    console.log('  detect    - Detect duplicates only')
    process.exit(1)
  }

  const detector = new VehicleDuplicateDetector()

  switch (command) {
    case 'process':
      await detector.processDuplicateDetection(vehicleId)
      break
    case 'forensics':
      await detector.processVehicleImages(vehicleId)
      break
    case 'detect':
      const matches = await detector.detectDuplicates(vehicleId)
      console.log('Duplicate matches:', JSON.stringify(matches, null, 2))
      break
    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }
}

// ES module equivalent of require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { VehicleDuplicateDetector }