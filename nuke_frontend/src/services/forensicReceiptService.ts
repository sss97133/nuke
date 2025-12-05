/**
 * Forensic Receipt Service
 * 
 * The core insight: Images ARE receipts when properly analyzed and bundled.
 * This service orchestrates the forensic analysis pipeline:
 * 
 * 1. Groups images by GPS + date + vehicle into "work sessions"
 * 2. Analyzes each session with AI to detect work performed
 * 3. Extracts products/brands/materials (sponsorship opportunities)
 * 4. Estimates value using AI + Mitchell Guide + market rates
 * 5. Creates synthetic receipts from forensic evidence
 * 6. Links organizations via GPS proximity
 * 
 * 5Ws Framework:
 * - WHO: Client (vehicle owner), service provider, products/brands
 * - WHAT: Vehicle, process, materials, commodities
 * - WHERE: GPS location → matched organization
 * - WHEN: EXIF timestamps
 * - WHY: Purpose derived from context
 */

import { supabase } from '../lib/supabase';

// Types
interface ForensicWorkSession {
  sessionId: string;
  vehicleId: string;
  imageIds: string[];
  images: Array<{
    id: string;
    image_url: string;
    taken_at: string | null;
    latitude: number | null;
    longitude: number | null;
    exif_data: any;
    uploaded_by: string;
  }>;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  gps: {
    latitude: number;
    longitude: number;
  } | null;
  userId: string;
}

interface ForensicAnalysisResult {
  workLog: {
    title: string;
    description: string;
    workPerformed: string[];
    partsExtracted: Array<{
      name: string;
      brand?: string;
      partNumber?: string;
      category: 'material' | 'fastener' | 'consumable' | 'component' | 'tool';
      quantity: number;
      unit?: string;
      estimatedPrice: number;
      supplier?: string;
      notes?: string;
    }>;
    laborBreakdown: Array<{
      task: string;
      category: 'removal' | 'fabrication' | 'installation' | 'finishing' | 'diagnosis';
      hours: number;
      difficulty: number;
    }>;
    estimatedLaborHours: number;
    qualityRating: number;
    qualityJustification: string;
    valueImpact: number;
    conditionNotes: string;
    tags: string[];
    confidence: number;
    concerns: string[];
  };
  matchedOrganization?: {
    id: string;
    name: string;
    matchConfidence: number;
    matchReason: string;
  };
  syntheticReceipt?: {
    id: string;
    total: number;
    laborCost: number;
    partsCost: number;
  };
}

interface SyntheticReceipt {
  vehicleId: string;
  organizationId?: string;
  sessionId: string;
  receiptDate: string;
  vendor: string;
  total: number;
  laborCost: number;
  partsCost: number;
  laborHours: number;
  lineItems: Array<{
    description: string;
    category: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    brand?: string;
    partNumber?: string;
  }>;
  evidenceImageIds: string[];
  confidence: number;
  source: 'forensic_analysis';
}

export class ForensicReceiptService {
  /**
   * Main entry point: Process uploaded images into forensic work sessions
   * Call this after a batch of images is uploaded
   */
  static async processUploadedImages(
    vehicleId: string,
    imageIds: string[],
    userId: string
  ): Promise<{ success: boolean; sessions: ForensicAnalysisResult[]; error?: string }> {
    try {
      console.log(`🔬 [ForensicReceipt] Processing ${imageIds.length} images for vehicle ${vehicleId}`);
      
      // 1. Fetch image data with EXIF
      const { data: images, error: fetchError } = await supabase
        .from('vehicle_images')
        .select('id, image_url, taken_at, latitude, longitude, exif_data, uploaded_by')
        .in('id', imageIds)
        .eq('vehicle_id', vehicleId);
      
      if (fetchError || !images || images.length === 0) {
        return { success: false, sessions: [], error: 'Failed to fetch images' };
      }
      
      console.log(`🔬 [ForensicReceipt] Fetched ${images.length} images with metadata`);
      
      // 2. Group images into forensic work sessions
      const sessions = this.groupIntoWorkSessions(images, vehicleId, userId);
      console.log(`🔬 [ForensicReceipt] Grouped into ${sessions.length} work sessions`);
      
      // 3. Process each session
      const results: ForensicAnalysisResult[] = [];
      
      for (const session of sessions) {
        try {
          const result = await this.processWorkSession(session);
          results.push(result);
        } catch (err) {
          console.error(`🔬 [ForensicReceipt] Failed to process session ${session.sessionId}:`, err);
        }
      }
      
      console.log(`🔬 [ForensicReceipt] Successfully processed ${results.length}/${sessions.length} sessions`);
      
      return { success: true, sessions: results };
      
    } catch (error: any) {
      console.error('🔬 [ForensicReceipt] Error:', error);
      return { success: false, sessions: [], error: error.message };
    }
  }
  
  /**
   * Group images into work sessions based on time and GPS proximity
   */
  private static groupIntoWorkSessions(
    images: any[],
    vehicleId: string,
    userId: string
  ): ForensicWorkSession[] {
    if (images.length === 0) return [];
    
    // Sort by taken_at time
    const sorted = [...images].sort((a, b) => {
      const aTime = a.taken_at ? new Date(a.taken_at).getTime() : 0;
      const bTime = b.taken_at ? new Date(b.taken_at).getTime() : 0;
      return aTime - bTime;
    });
    
    const sessions: ForensicWorkSession[] = [];
    let currentSession: ForensicWorkSession | null = null;
    
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const GPS_THRESHOLD_METERS = 100; // Same location within 100m
    
    for (const img of sorted) {
      const imgTime = img.taken_at ? new Date(img.taken_at) : new Date();
      const imgGps = (img.latitude && img.longitude) 
        ? { latitude: img.latitude, longitude: img.longitude }
        : null;
      
      const shouldStartNewSession = !currentSession || 
        // Time gap > 4 hours
        (imgTime.getTime() - currentSession.endTime.getTime() > FOUR_HOURS_MS) ||
        // Different GPS location
        (imgGps && currentSession.gps && 
          this.calculateDistance(imgGps.latitude, imgGps.longitude, 
            currentSession.gps.latitude, currentSession.gps.longitude) > GPS_THRESHOLD_METERS);
      
      if (shouldStartNewSession) {
        if (currentSession) {
          sessions.push(currentSession);
        }
        
        currentSession = {
          sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          vehicleId,
          imageIds: [img.id],
          images: [img],
          startTime: imgTime,
          endTime: imgTime,
          durationMinutes: 0,
          gps: imgGps,
          userId
        };
      } else {
        currentSession!.imageIds.push(img.id);
        currentSession!.images.push(img);
        currentSession!.endTime = imgTime;
        currentSession!.durationMinutes = 
          (currentSession!.endTime.getTime() - currentSession!.startTime.getTime()) / (1000 * 60);
        
        // Update GPS to most recent if available
        if (imgGps) {
          currentSession!.gps = imgGps;
        }
      }
    }
    
    if (currentSession) {
      sessions.push(currentSession);
    }
    
    return sessions;
  }
  
  /**
   * Process a single work session through the forensic pipeline
   * 
   * The flow:
   * 1. GPS → Organization matching (WHERE)
   * 2. generate-work-logs → AI analysis of images (WHAT, WHO, WHY)
   *    - This edge function already creates:
   *      - timeline_events
   *      - work_order_parts
   *      - work_order_labor
   *      - work_order_materials
   *      - event_financial_records
   *      - event_participants
   *      - image_forensic_attribution
   * 3. Link vehicle to organization if GPS matched
   */
  private static async processWorkSession(
    session: ForensicWorkSession
  ): Promise<ForensicAnalysisResult> {
    console.log(`🔬 [ForensicReceipt] Analyzing session ${session.sessionId} with ${session.images.length} images`);
    
    // 1. Try to match organization from GPS (WHERE)
    let matchedOrg: ForensicAnalysisResult['matchedOrganization'] | undefined;
    if (session.gps) {
      matchedOrg = await this.matchOrganizationFromGPS(session.gps.latitude, session.gps.longitude);
      if (matchedOrg) {
        console.log(`🔬 [ForensicReceipt] GPS matched org: ${matchedOrg.name} (${matchedOrg.matchConfidence * 100}%)`);
      }
    }
    
    // 2. Call generate-work-logs edge function for comprehensive analysis
    // This is the main forensic analysis - it creates timeline events, work orders, etc.
    const workLog = await this.generateWorkLog(session, matchedOrg?.id);
    
    // NOTE: generate-work-logs already creates:
    // - timeline_events with detailed metadata
    // - work_order_parts (components)
    // - work_order_materials (consumables)
    // - work_order_labor (task breakdown)
    // - event_financial_records
    // - event_participants (image maker, AI-suggested workers)
    // - image_forensic_attribution (for no-EXIF images)
    // - ai_scan_sessions
    // - ai_scan_field_confidence
    
    // So we DON'T need to create duplicate synthetic receipts or timeline events!
    
    // 3. Link vehicle to organization if GPS matched
    if (matchedOrg) {
      await this.linkVehicleToOrganization(session.vehicleId, matchedOrg.id, session.userId);
    }
    
    // The "synthetic receipt" is effectively the timeline_event + work_order_* records
    // created by generate-work-logs. Calculate totals for return value.
    let syntheticReceipt: ForensicAnalysisResult['syntheticReceipt'] | undefined;
    if (workLog) {
      const laborCost = workLog.laborBreakdown.reduce((sum, t) => sum + (t.hours * 125), 0);
      const partsCost = workLog.partsExtracted.reduce((sum, p) => sum + (p.estimatedPrice * p.quantity), 0);
      syntheticReceipt = {
        id: session.sessionId, // Timeline event ID is returned from generate-work-logs
        total: laborCost + partsCost,
        laborCost,
        partsCost
      };
    }
    
    return {
      workLog: workLog || this.getDefaultWorkLog(session),
      matchedOrganization: matchedOrg,
      syntheticReceipt
    };
  }
  
  /**
   * Match organization from GPS coordinates
   */
  private static async matchOrganizationFromGPS(
    latitude: number,
    longitude: number
  ): Promise<ForensicAnalysisResult['matchedOrganization'] | undefined> {
    try {
      // Use PostGIS to find organizations within 100m
      const { data, error } = await supabase
        .rpc('find_organizations_near_location', {
          p_latitude: latitude,
          p_longitude: longitude,
          p_max_distance_meters: 100
        });
      
      if (error || !data || data.length === 0) {
        // Try broader search with 500m
        const { data: broaderData } = await supabase
          .rpc('find_organizations_near_location', {
            p_latitude: latitude,
            p_longitude: longitude,
            p_max_distance_meters: 500
          });
        
        if (broaderData && broaderData.length > 0) {
          const org = broaderData[0];
          return {
            id: org.id,
            name: org.business_name,
            matchConfidence: Math.max(0.5, 1 - (org.distance_meters / 500)),
            matchReason: `GPS proximity: ${Math.round(org.distance_meters)}m away`
          };
        }
        return undefined;
      }
      
      const org = data[0];
      return {
        id: org.id,
        name: org.business_name,
        matchConfidence: Math.max(0.8, 1 - (org.distance_meters / 100)),
        matchReason: `GPS proximity: ${Math.round(org.distance_meters)}m away`
      };
      
    } catch (err) {
      console.warn('GPS organization matching failed:', err);
      return undefined;
    }
  }
  
  /**
   * Call the generate-work-logs edge function for comprehensive analysis
   * This is the heart of the forensic system - it extracts the 5Ws from image bundles
   */
  private static async generateWorkLog(
    session: ForensicWorkSession,
    organizationId?: string
  ): Promise<ForensicAnalysisResult['workLog'] | null> {
    try {
      console.log(`🔬 [ForensicReceipt] Calling generate-work-logs for ${session.imageIds.length} images`);
      
      // The generate-work-logs function requires both vehicleId AND organizationId
      // If we don't have an org, create a placeholder or skip the detailed analysis
      const effectiveOrgId = organizationId || '00000000-0000-0000-0000-000000000000'; // Placeholder
      
      const { data, error } = await supabase.functions.invoke('generate-work-logs', {
        body: {
          vehicleId: session.vehicleId,
          organizationId: effectiveOrgId,
          imageIds: session.imageIds,
          eventDate: session.startTime.toISOString().split('T')[0]
        }
      });
      
      if (error) {
        console.warn('🔬 [ForensicReceipt] generate-work-logs failed:', error);
        return null;
      }
      
      if (data?.success) {
        console.log(`🔬 [ForensicReceipt] Work log generated: "${data.workLog?.title}"`);
        console.log(`  - Parts: ${data.partsCount || 0}`);
        console.log(`  - Labor tasks: ${data.laborTasksCount || 0}`);
        console.log(`  - Event ID: ${data.eventId}`);
        
        return data.workLog || null;
      }
      
      return null;
      
    } catch (err) {
      console.warn('🔬 [ForensicReceipt] Failed to generate work log:', err);
      return null;
    }
  }
  
  // NOTE: createSyntheticReceipt and createTimelineEvent are handled by
  // the generate-work-logs edge function, which creates:
  // - timeline_events
  // - work_order_parts
  // - work_order_labor  
  // - work_order_materials
  // - event_financial_records
  // - event_participants
  // - ai_scan_sessions
  // - ai_scan_field_confidence
  // - image_forensic_attribution
  
  /**
   * Link vehicle to organization
   */
  private static async linkVehicleToOrganization(
    vehicleId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    try {
      // Check if link already exists
      const { data: existing } = await supabase
        .from('organization_vehicles')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      
      if (existing) {
        // Update existing link
        await supabase
          .from('organization_vehicles')
          .update({
            updated_at: new Date().toISOString(),
            receipt_match_count: supabase.rpc('increment_receipt_count')
          })
          .eq('id', existing.id);
      } else {
        // Create new link
        await supabase
          .from('organization_vehicles')
          .insert({
            vehicle_id: vehicleId,
            organization_id: organizationId,
            relationship_type: 'service_provider',
            status: 'active',
            auto_tagged: true,
            linked_by_user_id: userId,
            start_date: new Date().toISOString().split('T')[0]
          });
      }
      
      console.log(`🔬 [ForensicReceipt] Linked vehicle ${vehicleId} to org ${organizationId}`);
      
    } catch (err) {
      console.warn('Failed to link vehicle to organization:', err);
    }
  }
  
  /**
   * Calculate distance between two GPS coordinates in meters
   */
  private static calculateDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number
  ): number {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }
  
  /**
   * Default work log when AI analysis fails
   */
  private static getDefaultWorkLog(session: ForensicWorkSession): ForensicAnalysisResult['workLog'] {
    return {
      title: `Work Session (${session.images.length} photos)`,
      description: 'Work session documented with photos',
      workPerformed: ['Work documented via photos'],
      partsExtracted: [],
      laborBreakdown: [],
      estimatedLaborHours: session.durationMinutes / 60,
      qualityRating: 0,
      qualityJustification: 'Unable to assess from images',
      valueImpact: 0,
      conditionNotes: '',
      tags: ['work_session'],
      confidence: 0.3,
      concerns: ['AI analysis unavailable']
    };
  }
}

