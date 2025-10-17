/**
 * AI-Powered Image Processing Service with Guardrails
 * Implements the three-layer knowledge system for intelligent image filing
 */

import { supabase } from '../lib/supabase';
import { extractImageMetadata } from '../utils/imageMetadata';

// Types for the three-layer guardrail system
export interface UserGuardrails {
  personal: PersonalGuardrails;
  domain: DomainGuardrails;
  organizational: OrganizationalGuardrails;
}

export interface PersonalGuardrails {
  profession: 'mechanic' | 'dealer' | 'enthusiast' | 'collector' | 'other';
  expertise_areas: string[];
  typical_work_scenarios: string[];
  preferred_filing_structure: 'by_vehicle' | 'by_date' | 'by_type' | 'by_project';
  privacy_settings: {
    blur_license_plates: boolean;
    encrypt_vins: boolean;
    redact_customer_info: boolean;
  };
  business_info?: {
    name?: string;
    license?: string;
  };
}

export interface DomainGuardrails {
  part_identification: {
    level: 'none' | 'basic' | 'intermediate' | 'expert';
    include_part_numbers: boolean;
    cross_reference_catalogs: boolean;
    estimate_condition: boolean;
  };
  work_stage_detection: boolean;
  problem_diagnosis: boolean;
  progress_tracking: boolean;
  make_cost_estimates: boolean;
  suggest_next_steps: boolean;
  identify_safety_concerns: boolean;
}

export interface OrganizationalGuardrails {
  filing_triggers: {
    detect_vin_in_image: boolean;
    match_recent_context: boolean;
    use_gps_location: boolean;
    analyze_visible_vehicles: boolean;
  };
  auto_categorization: {
    by_work_type: boolean;
    by_component: boolean;
    by_angle: boolean;
    by_quality: boolean;
  };
  timeline_creation: {
    auto_create_events: boolean;
    batch_similar_photos: boolean;
    extract_work_narrative: boolean;
  };
}

export interface ProcessingContext {
  vehicleId?: string;
  userId: string;
  workSessionId?: string;
  location?: { lat: number; lng: number };
  recentActivity?: {
    lastVehicleId?: string;
    lastCategory?: string;
    lastWorkType?: string;
  };
}

export interface AIProcessingResult {
  success: boolean;
  filingDecision: {
    vehicleId: string;
    category: string;
    tags: string[];
    confidence: number;
  };
  extractedData: {
    vin?: string;
    partNumbers?: string[];
    text?: string[];
    workStage?: string;
    detectedIssues?: string[];
  };
  suggestedActions?: string[];
  privacyActions?: string[];
}

export class AIImageProcessingService {
  private static userGuardrailsCache = new Map<string, UserGuardrails>();

  /**
   * Get or create user-specific guardrails
   */
  static async getUserGuardrails(userId: string): Promise<UserGuardrails> {
    // Check cache first
    if (this.userGuardrailsCache.has(userId)) {
      return this.userGuardrailsCache.get(userId)!;
    }

    // Load from database
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Load user preferences
    const { data: preferences } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Construct guardrails based on user profile and preferences
    const guardrails = this.constructGuardrails(userProfile, preferences);
    
    // Cache for future use
    this.userGuardrailsCache.set(userId, guardrails);
    
    return guardrails;
  }

  /**
   * Construct guardrails from user data
   */
  private static constructGuardrails(profile: any, preferences: any): UserGuardrails {
    // Default guardrails
    const defaultGuardrails: UserGuardrails = {
      personal: {
        profession: 'enthusiast',
        expertise_areas: [],
        typical_work_scenarios: ['personal_project'],
        preferred_filing_structure: 'by_vehicle',
        privacy_settings: {
          blur_license_plates: false,
          encrypt_vins: false,
          redact_customer_info: false
        }
      },
      domain: {
        part_identification: {
          level: 'basic',
          include_part_numbers: false,
          cross_reference_catalogs: false,
          estimate_condition: false
        },
        work_stage_detection: true,
        problem_diagnosis: false,
        progress_tracking: true,
        make_cost_estimates: false,
        suggest_next_steps: false,
        identify_safety_concerns: true
      },
      organizational: {
        filing_triggers: {
          detect_vin_in_image: true,
          match_recent_context: true,
          use_gps_location: false,
          analyze_visible_vehicles: true
        },
        auto_categorization: {
          by_work_type: true,
          by_component: true,
          by_angle: false,
          by_quality: false
        },
        timeline_creation: {
          auto_create_events: true,
          batch_similar_photos: true,
          extract_work_narrative: false
        }
      }
    };

    // Customize based on profession
    if (profile?.profession) {
      defaultGuardrails.personal.profession = profile.profession;
      
      // Mechanic-specific settings
      if (profile.profession === 'mechanic') {
        defaultGuardrails.domain.part_identification.level = 'expert';
        defaultGuardrails.domain.part_identification.include_part_numbers = true;
        defaultGuardrails.domain.problem_diagnosis = true;
        defaultGuardrails.domain.suggest_next_steps = true;
        defaultGuardrails.personal.privacy_settings.blur_license_plates = true;
      }
      
      // Dealer-specific settings
      if (profile.profession === 'dealer') {
        defaultGuardrails.organizational.auto_categorization.by_angle = true;
        defaultGuardrails.organizational.auto_categorization.by_quality = true;
        defaultGuardrails.domain.part_identification.estimate_condition = true;
        defaultGuardrails.personal.business_info = {
          name: profile.business_name,
          license: profile.dealer_license
        };
      }
    }

    // Apply user preferences
    if (preferences) {
      // Merge preferences into guardrails
      if (preferences.ai_settings) {
        Object.assign(defaultGuardrails, preferences.ai_settings);
      }
    }

    return defaultGuardrails;
  }

  /**
   * Process image with AI guardrails
   */
  static async processImageWithAI(
    file: File,
    context: ProcessingContext
  ): Promise<AIProcessingResult> {
    try {
      // Get user guardrails
      const guardrails = await this.getUserGuardrails(context.userId);

      // Extract metadata
      const metadata = await extractImageMetadata(file);

      // Apply privacy filters first
      const privacyActions = await this.applyPrivacyFilters(file, metadata, guardrails.personal.privacy_settings);

      // Layer 1: Arboreal (Tree) - Establish vehicle context
      const vehicleContext = await this.establishVehicleContext(metadata, context, guardrails);

      // Layer 2: Web Interface - Cross-reference within bounds
      const crossReferences = await this.applyCrossReferences(vehicleContext, metadata, guardrails);

      // Layer 3: Rhizomatic - Apply collective intelligence
      const inferenceResults = await this.applyCollectiveIntelligence(crossReferences, metadata, guardrails);

      // Make filing decision
      const filingDecision = await this.makeFilingDecision(
        vehicleContext,
        crossReferences,
        inferenceResults,
        guardrails
      );

      // Extract additional data based on domain guardrails
      const extractedData = await this.extractDomainSpecificData(metadata, guardrails.domain);

      // Generate suggested actions if enabled
      const suggestedActions = guardrails.domain.suggest_next_steps
        ? await this.generateSuggestedActions(extractedData, inferenceResults)
        : undefined;

      return {
        success: true,
        filingDecision,
        extractedData,
        suggestedActions,
        privacyActions
      };

    } catch (error) {
      console.error('AI processing error:', error);
      return {
        success: false,
        filingDecision: {
          vehicleId: '',
          category: 'general',
          tags: [],
          confidence: 0
        },
        extractedData: {}
      };
    }
  }

  /**
   * Layer 1: Establish vehicle context (Arboreal layer)
   */
  private static async establishVehicleContext(
    metadata: any,
    context: ProcessingContext,
    guardrails: UserGuardrails
  ): Promise<any> {
    const vehicleContext = {
      primaryVehicleId: null,
      confidence: 0,
      method: 'unknown'
    };

    // Priority 1: Detect VIN in image
    if (guardrails.organizational.filing_triggers.detect_vin_in_image && metadata.text) {
      const vinPattern = /[A-HJ-NPR-Z0-9]{17}/;
      const vinMatch = metadata.text.match(vinPattern);
      
      if (vinMatch) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('id, year, make, model')
          .eq('vin', vinMatch[0])
          .single();
        
        if (vehicle) {
          vehicleContext.primaryVehicleId = vehicle.id;
          vehicleContext.confidence = 0.95;
          vehicleContext.method = 'vin_detection';
          return vehicleContext;
        }
      }
    }

    // Priority 2: Use recent context
    if (guardrails.organizational.filing_triggers.match_recent_context && context.recentActivity?.lastVehicleId) {
      vehicleContext.primaryVehicleId = context.recentActivity.lastVehicleId;
      vehicleContext.confidence = 0.75;
      vehicleContext.method = 'recent_context';
      return vehicleContext;
    }

    // Priority 3: GPS location matching
    if (guardrails.organizational.filing_triggers.use_gps_location && metadata.gps) {
      // Match to known work locations
      const locationMatch = await this.matchLocationToVehicle(metadata.gps);
      if (locationMatch) {
        vehicleContext.primaryVehicleId = locationMatch.vehicleId;
        vehicleContext.confidence = 0.65;
        vehicleContext.method = 'gps_location';
        return vehicleContext;
      }
    }

    // Priority 4: Visual vehicle analysis
    if (guardrails.organizational.filing_triggers.analyze_visible_vehicles) {
      // This would call an AI vision API to identify vehicles in the image
      // For now, return context from recent activity
      if (context.vehicleId) {
        vehicleContext.primaryVehicleId = context.vehicleId;
        vehicleContext.confidence = 0.5;
        vehicleContext.method = 'manual_context';
      }
    }

    return vehicleContext;
  }

  /**
   * Layer 2: Apply cross-references within vehicle bounds
   */
  private static async applyCrossReferences(
    vehicleContext: any,
    metadata: any,
    guardrails: UserGuardrails
  ): Promise<any> {
    const crossRefs = {
      relatedParts: [],
      relatedDocuments: [],
      timelinePosition: null,
      workPhase: null
    };

    if (!vehicleContext.primaryVehicleId) return crossRefs;

    // Cross-reference with existing vehicle data
    const { data: vehicleImages } = await supabase
      .from('vehicle_images')
      .select('category, tags, taken_at')
      .eq('vehicle_id', vehicleContext.primaryVehicleId)
      .order('taken_at', { ascending: false })
      .limit(10);

    // Determine work phase based on recent images
    if (vehicleImages && vehicleImages.length > 0) {
      const recentCategories = vehicleImages.map(img => img.category);
      crossRefs.workPhase = this.inferWorkPhase(recentCategories);
    }

    // If part identification is enabled, cross-reference parts
    if (guardrails.domain.part_identification.level !== 'none' && metadata.detectedObjects) {
      crossRefs.relatedParts = await this.crossReferenceParts(
        metadata.detectedObjects,
        vehicleContext.primaryVehicleId
      );
    }

    return crossRefs;
  }

  /**
   * Layer 3: Apply collective intelligence from all vehicles
   */
  private static async applyCollectiveIntelligence(
    crossRefs: any,
    metadata: any,
    guardrails: UserGuardrails
  ): Promise<any> {
    const inferences = {
      commonPatterns: [],
      suggestedCategory: null,
      workSequencePosition: null,
      estimatedDuration: null
    };

    // Only apply if user has sufficient expertise level
    if (guardrails.domain.part_identification.level === 'expert' || 
        guardrails.domain.part_identification.level === 'intermediate') {
      
      // Query patterns from similar vehicles
      const patterns = await this.queryCommonPatterns(metadata, crossRefs);
      inferences.commonPatterns = patterns;

      // Suggest category based on collective data
      if (patterns.length > 0) {
        inferences.suggestedCategory = patterns[0].category;
      }
    }

    return inferences;
  }

  /**
   * Make final filing decision combining all three layers
   */
  private static async makeFilingDecision(
    vehicleContext: any,
    crossRefs: any,
    inferences: any,
    guardrails: UserGuardrails
  ): Promise<any> {
    // Start with vehicle context
    const decision = {
      vehicleId: vehicleContext.primaryVehicleId || '',
      category: 'general',
      tags: [],
      confidence: vehicleContext.confidence || 0
    };

    // Apply categorization rules
    if (guardrails.organizational.auto_categorization.by_work_type && crossRefs.workPhase) {
      decision.category = this.mapWorkPhaseToCategory(crossRefs.workPhase);
      decision.tags.push(crossRefs.workPhase);
    }

    // Use collective intelligence suggestions if available
    if (inferences.suggestedCategory && decision.confidence < 0.8) {
      decision.category = inferences.suggestedCategory;
      decision.confidence = Math.max(decision.confidence, 0.7);
    }

    // Add tags based on detected content
    if (crossRefs.relatedParts.length > 0) {
      decision.tags.push(...crossRefs.relatedParts.map((p: any) => p.name));
    }

    return decision;
  }

  /**
   * Extract domain-specific data based on guardrails
   */
  private static async extractDomainSpecificData(
    metadata: any,
    domainGuardrails: DomainGuardrails
  ): Promise<any> {
    const extracted: any = {};

    // Extract text if available
    if (metadata.text) {
      extracted.text = metadata.text.split('\n').filter((t: string) => t.trim());
      
      // Extract VIN
      const vinMatch = metadata.text.match(/[A-HJ-NPR-Z0-9]{17}/);
      if (vinMatch) {
        extracted.vin = vinMatch[0];
      }

      // Extract part numbers if enabled
      if (domainGuardrails.part_identification.include_part_numbers) {
        const partNumbers = metadata.text.match(/[A-Z0-9]{2,}-[A-Z0-9]{3,}/g);
        if (partNumbers) {
          extracted.partNumbers = partNumbers;
        }
      }
    }

    // Detect work stage if enabled
    if (domainGuardrails.work_stage_detection && metadata.scene) {
      extracted.workStage = this.detectWorkStage(metadata.scene);
    }

    // Identify issues if diagnosis enabled
    if (domainGuardrails.problem_diagnosis && metadata.detectedIssues) {
      extracted.detectedIssues = metadata.detectedIssues;
    }

    return extracted;
  }

  /**
   * Apply privacy filters based on user settings
   */
  private static async applyPrivacyFilters(
    file: File,
    metadata: any,
    privacySettings: PersonalGuardrails['privacy_settings']
  ): Promise<string[]> {
    const actions: string[] = [];

    if (privacySettings.blur_license_plates && metadata.licensePlates) {
      actions.push('blur_license_plates');
      // Would apply actual blurring here
    }

    if (privacySettings.encrypt_vins && metadata.vin) {
      actions.push('encrypt_vin');
      // Would encrypt VIN data here
    }

    if (privacySettings.redact_customer_info && metadata.customerInfo) {
      actions.push('redact_customer_info');
      // Would redact customer information here
    }

    return actions;
  }

  /**
   * Helper methods
   */
  private static inferWorkPhase(recentCategories: string[]): string {
    const categoryCount = recentCategories.reduce((acc, cat) => {
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    if (categoryCount['disassembly'] > 2) return 'disassembly_phase';
    if (categoryCount['repair'] > 2) return 'repair_phase';
    if (categoryCount['assembly'] > 2) return 'assembly_phase';
    if (categoryCount['testing'] > 1) return 'testing_phase';
    
    return 'documentation_phase';
  }

  private static mapWorkPhaseToCategory(workPhase: string): string {
    const mapping: Record<string, string> = {
      'disassembly_phase': 'disassembly',
      'repair_phase': 'repair',
      'assembly_phase': 'assembly',
      'testing_phase': 'testing',
      'documentation_phase': 'general'
    };
    return mapping[workPhase] || 'general';
  }

  private static detectWorkStage(sceneData: any): string {
    // Simplified work stage detection
    if (sceneData.includes('parts_scattered')) return 'disassembly';
    if (sceneData.includes('tools_active')) return 'active_work';
    if (sceneData.includes('clean_assembled')) return 'completed';
    return 'in_progress';
  }

  private static async matchLocationToVehicle(gps: any): Promise<any> {
    // Would implement actual GPS to vehicle matching
    // For now, return null
    return null;
  }

  private static async crossReferenceParts(detectedObjects: any[], vehicleId: string): Promise<any[]> {
    // Would implement actual part cross-referencing
    return [];
  }

  private static async queryCommonPatterns(metadata: any, crossRefs: any): Promise<any[]> {
    // Would query collective intelligence patterns
    return [];
  }

  private static async generateSuggestedActions(extractedData: any, inferences: any): Promise<string[]> {
    const suggestions: string[] = [];

    if (extractedData.detectedIssues && extractedData.detectedIssues.length > 0) {
      suggestions.push('Document the identified issues in detail');
      suggestions.push('Take close-up photos of problem areas');
    }

    if (extractedData.workStage === 'disassembly') {
      suggestions.push('Label and organize removed parts');
      suggestions.push('Document the disassembly sequence');
    }

    if (inferences.commonPatterns.length > 0) {
      suggestions.push(`Review similar cases: ${inferences.commonPatterns[0].description}`);
    }

    return suggestions;
  }

  /**
   * Update guardrails based on user feedback
   */
  static async updateGuardrailsFromFeedback(
    userId: string,
    feedback: {
      correctVehicleId?: string;
      correctCategory?: string;
      preferredFilingMethod?: string;
    }
  ): Promise<void> {
    // Learn from user corrections
    const guardrails = await this.getUserGuardrails(userId);
    
    // Update preferences based on feedback
    if (feedback.preferredFilingMethod) {
      // Adjust filing trigger weights
      const { error } = await supabase
        .from('user_preferences')
        .update({
          ai_settings: {
            ...guardrails,
            last_updated: new Date().toISOString(),
            feedback_count: (guardrails as any).feedback_count ? (guardrails as any).feedback_count + 1 : 1
          }
        })
        .eq('user_id', userId);

      if (!error) {
        // Clear cache to force reload
        this.userGuardrailsCache.delete(userId);
      }
    }
  }
}
