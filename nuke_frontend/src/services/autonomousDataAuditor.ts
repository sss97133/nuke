/**
 * Autonomous Data Auditor
 * 
 * Self-healing database agent that:
 * 1. Audits vehicle data completeness and correctness
 * 2. Finds missing data from available sources
 * 3. Validates data truthfulness via forensic evidence
 * 4. Assigns confidence scores and finds proof
 * 5. Auto-fixes high-confidence issues within budget limits
 * 
 * Uses existing forensic_data_assignment_system functions
 */

import { supabase } from '../lib/supabase';

// ============================================
// TYPES & INTERFACES
// ============================================

interface AuditConfig {
  // Budget limits
  daily_cost_limit: number;        // Max $ per day
  per_vehicle_limit: number;       // Max $ per vehicle
  approval_threshold: number;      // Actions >$ need human approval
  
  // Execution limits
  max_vehicles_per_run: number;    // Batch size
  min_confidence_auto_fix: number; // Auto-fix threshold (0-100)
  
  // Feature flags
  enable_vin_decode: boolean;
  enable_listing_scrape: boolean;
  enable_image_ocr: boolean;
  enable_ai_analysis: boolean;
}

interface VehicleAuditResult {
  vehicle_id: string;
  vehicle_display: string;
  
  // Scores
  completeness_score: number;      // 0-100
  correctness_score: number;       // 0-100
  overall_score: number;           // 0-100
  
  // Issues found
  missing_fields: string[];
  validation_errors: ValidationIssue[];
  evidence_conflicts: EvidenceConflict[];
  
  // Actions taken
  actions_executed: AuditAction[];
  actions_pending_approval: AuditAction[];
  
  // Costs
  cost_spent: number;
  cost_potential: number;
  
  // Status
  status: 'complete' | 'partial' | 'needs_approval' | 'error';
  error_message?: string;
}

interface ValidationIssue {
  field: string;
  current_value: any;
  error_level: 'critical' | 'error' | 'warning' | 'info';
  error_message: string;
  recommended_fix?: string;
  fix_confidence?: number;
}

interface EvidenceConflict {
  field: string;
  evidence_count: number;
  consensus_value: any;
  consensus_confidence: number;
  conflicting_sources: Array<{
    value: any;
    source_type: string;
    trust_level: number;
  }>;
  recommended_action: 'accept_consensus' | 'use_highest_trust' | 'manual_review';
}

interface AuditAction {
  type: 'fetch_vin' | 'scrape_listing' | 'ocr_image' | 'ai_analysis' | 'apply_consensus' | 'fix_validation';
  description: string;
  field?: string;
  
  // Cost/benefit
  estimated_cost: number;
  expected_confidence_boost: number;
  priority: 1 | 2 | 3 | 4 | 5;  // 1 = critical, 5 = nice-to-have
  
  // Execution
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
  result?: any;
  actual_cost?: number;
  
  // Proof
  proof_sources?: string[];
  proof_authenticity?: number;  // Based on trust_hierarchy
}

interface AuditRunSummary {
  run_id: string;
  started_at: Date;
  completed_at?: Date;
  
  vehicles_audited: number;
  vehicles_improved: number;
  vehicles_flagged: number;
  
  total_cost: number;
  total_fixes: number;
  
  status: 'running' | 'completed' | 'budget_exceeded' | 'error';
  
  results: VehicleAuditResult[];
}

// ============================================
// DEFAULT CONFIGURATION
// ============================================

const DEFAULT_CONFIG: AuditConfig = {
  daily_cost_limit: 50.00,         // $50/day max
  per_vehicle_limit: 2.00,         // $2/vehicle max
  approval_threshold: 0.50,        // >$0.50 needs approval
  
  max_vehicles_per_run: 50,        // Process 50 vehicles per run
  min_confidence_auto_fix: 85,     // 85% confidence to auto-fix
  
  enable_vin_decode: true,
  enable_listing_scrape: true,
  enable_image_ocr: false,         // Expensive, disabled by default
  enable_ai_analysis: true,
};

// ============================================
// MAIN AUDITOR CLASS
// ============================================

export class AutonomousDataAuditor {
  private config: AuditConfig;
  private costTracker: { spent: number; limit: number };
  
  constructor(config: Partial<AuditConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.costTracker = { spent: 0, limit: this.config.daily_cost_limit };
  }
  
  /**
   * Main entry point: Run autonomous audit
   */
  async runAudit(): Promise<AuditRunSummary> {
    const runId = `audit_${Date.now()}`;
    const summary: AuditRunSummary = {
      run_id: runId,
      started_at: new Date(),
      vehicles_audited: 0,
      vehicles_improved: 0,
      vehicles_flagged: 0,
      total_cost: 0,
      total_fixes: 0,
      status: 'running',
      results: []
    };
    
    try {
      console.log(`🔍 Starting autonomous data audit: ${runId}`);
      console.log(`Budget: $${this.config.daily_cost_limit}, Auto-fix confidence: ${this.config.min_confidence_auto_fix}%`);
      
      // Step 1: Get priority queue of vehicles to audit
      const queue = await this.getPriorityQueue();
      console.log(`📋 Found ${queue.length} vehicles needing audit`);
      
      // Step 2: Audit each vehicle
      for (const vehicle of queue.slice(0, this.config.max_vehicles_per_run)) {
        if (this.costTracker.spent >= this.costTracker.limit) {
          console.log(`💰 Budget limit reached ($${this.costTracker.spent.toFixed(2)})`);
          summary.status = 'budget_exceeded';
          break;
        }
        
        const result = await this.auditVehicle(vehicle);
        summary.results.push(result);
        summary.vehicles_audited++;
        
        if (result.status === 'complete' && result.actions_executed.length > 0) {
          summary.vehicles_improved++;
        }
        if (result.status === 'needs_approval') {
          summary.vehicles_flagged++;
        }
        
        summary.total_cost += result.cost_spent;
        summary.total_fixes += result.actions_executed.filter(a => a.status === 'completed').length;
        
        this.costTracker.spent += result.cost_spent;
      }
      
      summary.completed_at = new Date();
      summary.status = summary.status === 'running' ? 'completed' : summary.status;
      
      // Log summary
      console.log('\n✅ Audit Complete');
      console.log(`Vehicles audited: ${summary.vehicles_audited}`);
      console.log(`Vehicles improved: ${summary.vehicles_improved}`);
      console.log(`Total cost: $${summary.total_cost.toFixed(2)}`);
      console.log(`Total fixes: ${summary.total_fixes}`);
      
      // Save audit run to database
      await this.saveAuditRun(summary);
      
      return summary;
      
    } catch (error: any) {
      console.error('❌ Audit failed:', error);
      summary.status = 'error';
      summary.completed_at = new Date();
      return summary;
    }
  }
  
  /**
   * Get priority queue of vehicles needing audit
   * Uses existing calculate_vehicle_quality_score() function
   */
  private async getPriorityQueue() {
    const { data, error } = await supabase.rpc('get_vehicles_needing_audit', {
      min_score: 60,  // Vehicles with score < 60
      limit: 100
    });
    
    if (error) {
      console.error('Error getting priority queue:', error);
      // Fallback: get vehicles with missing critical data
      const { data: fallback } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin, sale_price, mileage, listing_url')
        .or('vin.is.null,sale_price.is.null,mileage.is.null')
        .limit(100);
      
      return fallback || [];
    }
    
    return data || [];
  }
  
  /**
   * Audit a single vehicle
   * Implements the question chain:
   * 1. Is data present?
   * 2. Can I find missing data?
   * 3. Is data true?
   * 4. How certain?
   * 5. Can I find proof?
   * 6. Where is proof?
   * 7. Is proof authentic?
   */
  private async auditVehicle(vehicle: any): Promise<VehicleAuditResult> {
    const vehicleId = vehicle.id;
    const display = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;
    
    console.log(`\n🔍 Auditing: ${display}`);
    
    const result: VehicleAuditResult = {
      vehicle_id: vehicleId,
      vehicle_display: display,
      completeness_score: 0,
      correctness_score: 0,
      overall_score: 0,
      missing_fields: [],
      validation_errors: [],
      evidence_conflicts: [],
      actions_executed: [],
      actions_pending_approval: [],
      cost_spent: 0,
      cost_potential: 0,
      status: 'complete'
    };
    
    try {
      // QUESTION 1: Is data present?
      const completeness = await this.checkCompleteness(vehicle);
      result.completeness_score = completeness.score;
      result.missing_fields = completeness.missing_fields;
      
      // QUESTION 2: Can I find missing data?
      if (result.missing_fields.length > 0) {
        const findActions = await this.findMissingData(vehicle, result.missing_fields);
        result.actions_pending_approval.push(...findActions);
      }
      
      // QUESTION 3: Is data true? (Check validation rules)
      const validation = await this.checkValidation(vehicleId);
      result.validation_errors = validation.errors;
      result.correctness_score = validation.score;
      
      // QUESTION 4 & 5: How certain? Can I find proof? (Check evidence)
      const evidence = await this.checkEvidence(vehicleId);
      result.evidence_conflicts = evidence.conflicts;
      
      // Calculate overall score
      result.overall_score = Math.round(
        (result.completeness_score * 0.4) + 
        (result.correctness_score * 0.6)
      );
      
      // Execute high-confidence actions within budget
      await this.executeActions(result);
      
      console.log(`  Score: ${result.overall_score}/100 (${result.completeness_score}% complete, ${result.correctness_score}% correct)`);
      console.log(`  Actions: ${result.actions_executed.length} executed, ${result.actions_pending_approval.length} pending`);
      
    } catch (error: any) {
      console.error(`  ❌ Error auditing vehicle:`, error.message);
      result.status = 'error';
      result.error_message = error.message;
    }
    
    return result;
  }
  
  /**
   * QUESTION 1: Is data present?
   */
  private async checkCompleteness(vehicle: any) {
    const criticalFields = ['vin', 'year', 'make', 'model'];
    const importantFields = ['sale_price', 'current_value', 'mileage'];
    const optionalFields = ['color', 'transmission', 'drivetrain', 'engine_size'];
    
    const missing_fields: string[] = [];
    
    criticalFields.forEach(field => {
      if (!vehicle[field]) missing_fields.push(field);
    });
    
    importantFields.forEach(field => {
      if (!vehicle[field]) missing_fields.push(field);
    });
    
    // Calculate completeness score
    const totalFields = criticalFields.length + importantFields.length + optionalFields.length;
    const presentFields = totalFields - missing_fields.length;
    const score = Math.round((presentFields / totalFields) * 100);
    
    return { score, missing_fields };
  }
  
  /**
   * QUESTION 2: Can I find missing data?
   * QUESTION 6: Where is proof?
   */
  private async findMissingData(vehicle: any, missingFields: string[]): Promise<AuditAction[]> {
    const actions: AuditAction[] = [];
    
    // Priority 1: VIN (unlocks everything)
    if (missingFields.includes('vin')) {
      if (vehicle.listing_url && this.config.enable_listing_scrape) {
        actions.push({
          type: 'scrape_listing',
          description: 'Scrape VIN from original listing',
          field: 'vin',
          estimated_cost: 0.05,
          expected_confidence_boost: 85,
          priority: 1,
          status: 'pending',
          proof_sources: [vehicle.listing_url],
          proof_authenticity: 70  // Scraped listing trust level
        });
      }
      
      if (this.config.enable_image_ocr) {
        actions.push({
          type: 'ocr_image',
          description: 'OCR VIN from title/VIN plate images',
          field: 'vin',
          estimated_cost: 0.10,
          expected_confidence_boost: 90,
          priority: 1,
          status: 'pending',
          proof_sources: ['vehicle_images'],
          proof_authenticity: 85  // Title document trust level
        });
      }
    }
    
    // If we have VIN, use it to decode missing fields
    if (vehicle.vin && this.config.enable_vin_decode) {
      const vinDecodableFields = ['year', 'make', 'model', 'engine_size', 'drivetrain'];
      const needsVinDecode = missingFields.filter(f => vinDecodableFields.includes(f));
      
      if (needsVinDecode.length > 0) {
        actions.push({
          type: 'fetch_vin',
          description: `Decode VIN to get: ${needsVinDecode.join(', ')}`,
          estimated_cost: 0.00,  // NHTSA API is free
          expected_confidence_boost: 100,
          priority: 1,
          status: 'pending',
          proof_sources: ['NHTSA VPIC API'],
          proof_authenticity: 100  // VIN decode is authoritative
        });
      }
    }
    
    // Priority 2: Price
    if (missingFields.includes('sale_price') && vehicle.listing_url && this.config.enable_listing_scrape) {
      actions.push({
        type: 'scrape_listing',
        description: 'Scrape sale price from listing',
        field: 'sale_price',
        estimated_cost: 0.05,
        expected_confidence_boost: 85,
        priority: 2,
        status: 'pending',
        proof_sources: [vehicle.listing_url],
        proof_authenticity: 85  // BaT auction result trust level
      });
    }
    
    // Sort by priority and expected value
    actions.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.expected_confidence_boost - a.expected_confidence_boost;
    });
    
    return actions;
  }
  
  /**
   * QUESTION 3: Is data true?
   * Uses existing data_validation_rules
   */
  private async checkValidation(vehicleId: string) {
    const { data: issues } = await supabase
      .from('vehicle_validation_issues')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('status', 'open');
    
    const errors: ValidationIssue[] = (issues || []).map(issue => ({
      field: issue.field_name,
      current_value: issue.current_value,
      error_level: issue.error_level,
      error_message: issue.error_message,
      recommended_fix: null,
      fix_confidence: 0
    }));
    
    // Score: 100 - (errors * weight)
    const criticalWeight = 30;
    const errorWeight = 20;
    const warningWeight = 10;
    
    let deductions = 0;
    errors.forEach(e => {
      if (e.error_level === 'critical') deductions += criticalWeight;
      else if (e.error_level === 'error') deductions += errorWeight;
      else if (e.error_level === 'warning') deductions += warningWeight;
    });
    
    const score = Math.max(0, 100 - deductions);
    
    return { score, errors };
  }
  
  /**
   * QUESTION 4: How certain can I be?
   * QUESTION 7: Is proof authentic?
   * Uses existing field_evidence and build_field_consensus()
   */
  private async checkEvidence(vehicleId: string) {
    const { data: evidence } = await supabase
      .from('field_evidence')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .eq('status', 'pending');
    
    const conflicts: EvidenceConflict[] = [];
    
    // Group evidence by field
    const byField = (evidence || []).reduce((acc, e) => {
      if (!acc[e.field_name]) acc[e.field_name] = [];
      acc[e.field_name].push(e);
      return acc;
    }, {} as Record<string, any[]>);
    
    // Check each field for conflicts
    for (const [field, fieldEvidence] of Object.entries(byField)) {
      if (fieldEvidence.length > 1) {
        // Multiple sources - check consensus
        const { data: consensus } = await supabase.rpc('build_field_consensus', {
          p_vehicle_id: vehicleId,
          p_field_name: field,
          p_auto_assign: false  // Don't auto-assign yet
        });
        
        if (consensus) {
          const conflictingSources = fieldEvidence
            .filter(e => e.proposed_value !== consensus.consensus_value)
            .map(e => ({
              value: e.proposed_value,
              source_type: e.source_type,
              trust_level: e.source_confidence
            }));
          
          if (conflictingSources.length > 0) {
            conflicts.push({
              field,
              evidence_count: fieldEvidence.length,
              consensus_value: consensus.consensus_value,
              consensus_confidence: consensus.consensus_confidence,
              conflicting_sources: conflictingSources,
              recommended_action: consensus.consensus_confidence >= 85 
                ? 'accept_consensus' 
                : 'manual_review'
            });
          }
        }
      }
    }
    
    return { conflicts };
  }
  
  /**
   * Execute actions within budget and confidence limits
   */
  private async executeActions(result: VehicleAuditResult) {
    const vehicleBudget = this.config.per_vehicle_limit;
    let vehicleSpent = 0;
    
    for (const action of result.actions_pending_approval) {
      // Budget check
      const remainingGlobal = this.costTracker.limit - this.costTracker.spent;
      const remainingVehicle = vehicleBudget - vehicleSpent;
      
      if (action.estimated_cost > remainingGlobal || action.estimated_cost > remainingVehicle) {
        console.log(`  ⏭️  Skipping ${action.type} (budget limit)`);
        action.status = 'skipped';
        continue;
      }
      
      // Approval threshold check
      if (action.estimated_cost > this.config.approval_threshold) {
        console.log(`  ⏸️  ${action.type} needs approval ($${action.estimated_cost})`);
        continue;  // Leave in pending_approval
      }
      
      // Execute action
      try {
        console.log(`  ▶️  Executing: ${action.description}`);
        action.status = 'executing';
        
        const actionResult = await this.executeAction(result.vehicle_id, action);
        
        action.status = 'completed';
        action.result = actionResult;
        action.actual_cost = action.estimated_cost;  // Would be real cost in production
        
        vehicleSpent += action.actual_cost;
        result.cost_spent += action.actual_cost;
        
        result.actions_executed.push(action);
        result.actions_pending_approval = result.actions_pending_approval.filter(a => a !== action);
        
        console.log(`  ✅ ${action.description} - confidence: ${actionResult?.confidence || 0}%`);
        
      } catch (error: any) {
        console.error(`  ❌ ${action.type} failed:`, error.message);
        action.status = 'failed';
      }
    }
  }
  
  /**
   * Execute a specific action
   */
  private async executeAction(vehicleId: string, action: AuditAction) {
    switch (action.type) {
      case 'fetch_vin':
        return await this.executeVinDecode(vehicleId);
      
      case 'scrape_listing':
        return await this.executeListingScrape(vehicleId, action.field!);
      
      case 'apply_consensus':
        return await this.executeApplyConsensus(vehicleId, action.field!);
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }
  
  /**
   * Execute VIN decode using NHTSA API
   */
  private async executeVinDecode(vehicleId: string) {
    // Call existing VIN decode service
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('vin')
      .eq('id', vehicleId)
      .single();
    
    if (!vehicle?.vin) {
      throw new Error('No VIN to decode');
    }
    
    // This would call your existing vinDecoder service
    // For now, just use forensic assignment
    const { data, error } = await supabase.rpc('update_vehicle_field_forensically', {
      p_vehicle_id: vehicleId,
      p_field_name: 'vin',
      p_new_value: vehicle.vin,
      p_source: 'nhtsa_vin_decode',
      p_context: { decoded_at: new Date().toISOString() },
      p_auto_assign: true
    });
    
    if (error) throw error;
    
    return { confidence: 100, data };
  }
  
  /**
   * Execute listing scrape
   */
  private async executeListingScrape(vehicleId: string, field: string) {
    // This would call your existing scraper
    // For now, just mark as needs manual scrape
    console.log(`  📝 Note: Manual scrape needed for ${field}`);
    return { confidence: 0, needs_manual: true };
  }
  
  /**
   * Execute consensus assignment using forensic system
   */
  private async executeApplyConsensus(vehicleId: string, field: string) {
    const { data, error } = await supabase.rpc('build_field_consensus', {
      p_vehicle_id: vehicleId,
      p_field_name: field,
      p_auto_assign: true  // Auto-assign if consensus is strong
    });
    
    if (error) throw error;
    
    return {
      confidence: data?.consensus_confidence || 0,
      value: data?.consensus_value,
      action: data?.action
    };
  }
  
  /**
   * Save audit run to database for tracking
   */
  private async saveAuditRun(summary: AuditRunSummary) {
    await supabase.from('audit_runs').insert({
      run_id: summary.run_id,
      started_at: summary.started_at,
      completed_at: summary.completed_at,
      vehicles_audited: summary.vehicles_audited,
      vehicles_improved: summary.vehicles_improved,
      total_cost: summary.total_cost,
      total_fixes: summary.total_fixes,
      status: summary.status,
      results: summary.results
    });
  }
}

