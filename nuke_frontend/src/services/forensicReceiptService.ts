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
   * 1. First pass: Get AI analysis to understand WHAT work was done
   * 2. Use AI context (paint_booth, body_work, etc.) to boost GPS matching confidence
   * 3. GPS + AI context → Organization matching (WHERE)
   * 4. Link vehicle to organization if confident match
   * 
   * Confidence tiers:
   * - GPS within 50m = high confidence (auto-link)
   * - GPS within 500m + AI context match = high confidence (auto-link)
   * - GPS within 500m alone = low confidence (needs user confirmation)
   */
  private static async processWorkSession(
    session: ForensicWorkSession
  ): Promise<ForensicAnalysisResult> {
    console.log(`🔬 [ForensicReceipt] Analyzing session ${session.sessionId} with ${session.images.length} images`);
    
    // 1. First, do a quick AI analysis to understand WHAT work was done
    // This helps us boost GPS matching confidence
    const workLog = await this.generateWorkLog(session, undefined);
    
    // 2. Extract AI context from work log for GPS matching boost
    const aiContext = this.extractAIContext(workLog);
    console.log(`🔬 [ForensicReceipt] AI detected context: ${aiContext.join(', ') || 'none'}`);
    
    // 3. Try to match organization from GPS + AI context (WHERE)
    let matchedOrg: ForensicAnalysisResult['matchedOrganization'] | undefined;
    if (session.gps) {
      matchedOrg = await this.matchOrganizationFromGPS(
        session.gps.latitude, 
        session.gps.longitude,
        aiContext
      );
      
      if (matchedOrg) {
        const confidencePercent = Math.round(matchedOrg.matchConfidence * 100);
        if ((matchedOrg as any).needsConfirmation) {
          console.log(`🔬 [ForensicReceipt] Low confidence match: ${matchedOrg.name} (${confidencePercent}%) - NEEDS USER CONFIRMATION`);
        } else {
          console.log(`🔬 [ForensicReceipt] GPS+AI matched org: ${matchedOrg.name} (${confidencePercent}%)`);
        }
      }
    }
    
    // 4. If we have a confident match, update the work log with org context
    if (matchedOrg && matchedOrg.matchConfidence >= 0.5) {
      // Re-run work log generation with org context for better results
      const enhancedWorkLog = await this.generateWorkLog(session, matchedOrg.id);
      if (enhancedWorkLog) {
        Object.assign(workLog || {}, enhancedWorkLog);
      }
    }
    
    // 5. Link vehicle to organization ONLY if confidence is high enough
    // Low confidence matches are stored but NOT auto-linked (needs user confirmation)
    if (matchedOrg && matchedOrg.matchConfidence >= 0.5 && !(matchedOrg as any).needsConfirmation) {
      await this.linkVehicleToOrganization(
        session.vehicleId, 
        matchedOrg.id, 
        session.userId,
        matchedOrg.matchConfidence,
        [matchedOrg.matchReason]
      );
    }
    
    // Calculate totals for return value
    let syntheticReceipt: ForensicAnalysisResult['syntheticReceipt'] | undefined;
    if (workLog) {
      const laborCost = workLog.laborBreakdown.reduce((sum, t) => sum + (t.hours * 125), 0);
      const partsCost = workLog.partsExtracted.reduce((sum, p) => sum + (p.estimatedPrice * p.quantity), 0);
      syntheticReceipt = {
        id: session.sessionId,
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
   * Extract AI context keywords from work log for GPS matching boost
   */
  private static extractAIContext(workLog: ForensicAnalysisResult['workLog'] | null): string[] {
    if (!workLog) return [];
    
    const context: string[] = [];
    const tags = workLog.tags || [];
    const title = workLog.title?.toLowerCase() || '';
    const description = workLog.description?.toLowerCase() || '';
    const workPerformed = workLog.workPerformed?.join(' ').toLowerCase() || '';
    const allText = `${title} ${description} ${workPerformed} ${tags.join(' ')}`;
    
    // Paint/body work indicators
    if (allText.includes('paint') || allText.includes('primer') || allText.includes('clearcoat') || 
        allText.includes('spray') || allText.includes('booth')) {
      context.push('paint_booth', 'paint_work');
    }
    if (allText.includes('body') || allText.includes('dent') || allText.includes('panel') ||
        allText.includes('fender') || allText.includes('quarter')) {
      context.push('body_work');
    }
    
    // Restoration indicators
    if (allText.includes('restor') || allText.includes('fabricat') || allText.includes('weld') ||
        allText.includes('metal')) {
      context.push('restoration', 'fabrication', 'metalwork');
    }
    
    // Mechanical indicators
    if (allText.includes('engine') || allText.includes('motor') || allText.includes('transmission') ||
        allText.includes('mechanical') || allText.includes('repair')) {
      context.push('engine_work', 'mechanical');
    }
    
    // Performance indicators
    if (allText.includes('performance') || allText.includes('tuning') || allText.includes('racing') ||
        allText.includes('upgrade')) {
      context.push('performance', 'tuning');
    }
    
    // Interior indicators
    if (allText.includes('upholster') || allText.includes('interior') || allText.includes('seat') ||
        allText.includes('carpet')) {
      context.push('upholstery', 'interior');
    }
    
    return [...new Set(context)]; // Remove duplicates
  }
  
  /**
   * Match organization from GPS coordinates + AI context
   * 
   * Confidence tiers:
   * - GPS within 50m = high confidence (0.9)
   * - GPS within 500m + AI context match = high confidence (0.7-0.95)
   * - GPS within 500m alone = low confidence (0.3)
   * 
   * AI context examples: paint_booth, body_work, restoration, engine_work
   */
  private static async matchOrganizationFromGPS(
    latitude: number,
    longitude: number,
    aiContext?: string[]
  ): Promise<ForensicAnalysisResult['matchedOrganization'] | undefined> {
    try {
      // Use enhanced function with AI context for better matching
      const { data, error } = await supabase
        .rpc('find_organizations_near_location_v2', {
          p_latitude: latitude,
          p_longitude: longitude,
          p_ai_detected_context: aiContext || null,
          p_max_distance_meters: 500
        });
      
      if (error) {
        console.warn('Enhanced org matching failed, falling back to basic:', error);
        // Fallback to basic matching
        const { data: fallbackData } = await supabase
          .rpc('find_organizations_near_location', {
            p_latitude: latitude,
            p_longitude: longitude,
            p_max_distance_meters: 100
          });
        
        if (fallbackData && fallbackData.length > 0) {
          const org = fallbackData[0];
          return {
            id: org.id,
            name: org.business_name,
            matchConfidence: Math.max(0.7, 1 - (org.distance_meters / 100)),
            matchReason: `GPS proximity: ${Math.round(org.distance_meters)}m away`
          };
        }
        return undefined;
      }
      
      if (!data || data.length === 0) {
        return undefined;
      }
      
      const org = data[0];
      
      // Only return matches above minimum confidence threshold
      // Low confidence (0.3) matches need user confirmation
      if (org.final_confidence < 0.5) {
        console.log(`🔬 [ForensicReceipt] Low confidence match (${org.final_confidence}) for ${org.business_name} - needs user confirmation`);
        return {
          id: org.id,
          name: org.business_name,
          matchConfidence: org.final_confidence,
          matchReason: `Low confidence - ${org.confidence_reasons?.join(', ') || 'GPS only'}`,
          needsConfirmation: true
        } as any;
      }
      
      return {
        id: org.id,
        name: org.business_name,
        matchConfidence: org.final_confidence,
        matchReason: org.confidence_reasons?.join(', ') || `GPS: ${Math.round(org.distance_meters)}m`
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
   * Link vehicle to organization with confidence tracking
   * 
   * User overrides ALWAYS win:
   * - If user_confirmed = true, don't change
   * - If user_rejected = true, don't create link
   * - Store auto_matched_* data for auditing even if user overrides later
   */
  private static async linkVehicleToOrganization(
    vehicleId: string,
    organizationId: string,
    userId: string,
    confidence: number = 0.5,
    reasons: string[] = []
  ): Promise<void> {
    try {
      // Check if link already exists
      const { data: existing } = await supabase
        .from('organization_vehicles')
        .select('id, user_confirmed, user_rejected')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      
      if (existing) {
        // USER DATA WINS: If user has confirmed or rejected, don't override
        if (existing.user_confirmed || existing.user_rejected) {
          console.log(`🔬 [ForensicReceipt] User override in place, skipping auto-update`);
          return;
        }
        
        // Update existing link with new confidence data
        await supabase
          .from('organization_vehicles')
          .update({
            updated_at: new Date().toISOString(),
            auto_matched_confidence: confidence,
            auto_matched_reasons: reasons,
            auto_matched_at: new Date().toISOString()
          })
          .eq('id', existing.id);
          
        console.log(`🔬 [ForensicReceipt] Updated existing link (confidence: ${Math.round(confidence * 100)}%)`);
      } else {
        // Check if user has previously REJECTED this specific link
        const { data: rejected } = await supabase
          .from('organization_vehicles')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .eq('organization_id', organizationId)
          .eq('user_rejected', true)
          .maybeSingle();
        
        if (rejected) {
          console.log(`🔬 [ForensicReceipt] User previously rejected this link, skipping`);
          return;
        }
        
        // Create new link with confidence data
        await supabase
          .from('organization_vehicles')
          .insert({
            vehicle_id: vehicleId,
            organization_id: organizationId,
            relationship_type: 'service_provider',
            status: 'active',
            auto_tagged: true,
            linked_by_user_id: userId,
            start_date: new Date().toISOString().split('T')[0],
            // Store automation data for auditing
            auto_matched_confidence: confidence,
            auto_matched_reasons: reasons,
            auto_matched_at: new Date().toISOString(),
            // Not user confirmed yet
            user_confirmed: false,
            notes: `Auto-linked via forensic analysis (${Math.round(confidence * 100)}% confidence)`
          });
          
        console.log(`🔬 [ForensicReceipt] Created new link (confidence: ${Math.round(confidence * 100)}%)`);
      }
      
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

