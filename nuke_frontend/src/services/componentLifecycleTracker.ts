/**
 * Component Lifecycle Tracker
 * 
 * For complex restorations, simple before/after isn't enough.
 * We need to track COMPONENT STATE over TIME:
 * 
 * Example: Front Clip Restoration
 *   - Jan 15: REMOVED (6 hrs) - images [a,b,c]
 *   - Mar 20: PREPPED (4 hrs) - images [d,e]
 *   - Jun 10: PAINTED (8 hrs) - images [f,g,h]
 *   - Dec 15: INSTALLED (8 hrs) - images [i,j]
 *   TOTAL: 26 hrs labor over 11 months
 * 
 * The AI needs to:
 * 1. Identify components in images
 * 2. Track state changes over time
 * 3. Group related work sessions
 * 4. Calculate cumulative totals
 * 5. Handle time gaps (waiting for parts, other priorities)
 */

import { supabase } from '../lib/supabase';

// Component states in a restoration lifecycle
type ComponentState = 
  | 'original'           // Factory/as-found condition
  | 'removed'            // Taken off vehicle
  | 'disassembled'       // Broken down into sub-components
  | 'stored'             // Waiting for work
  | 'in_prep'            // Being prepped (sanding, rust removal, etc.)
  | 'in_fabrication'     // Metal work, welding, panel replacement
  | 'in_primer'          // Primed, waiting for paint
  | 'in_paint'           // Being painted
  | 'in_finishing'       // Clear coat, wet sanding, buffing
  | 'ready_to_install'   // Complete, waiting for installation
  | 'installed'          // Back on vehicle
  | 'complete';          // Fully done, verified

interface ComponentStateChange {
  componentId: string;
  componentName: string;
  fromState: ComponentState;
  toState: ComponentState;
  timestamp: string;
  imageIds: string[];
  laborHours: number;
  materials: Array<{
    name: string;
    cost: number;
  }>;
  notes: string;
  confidence: number;
}

interface ComponentLifecycle {
  componentId: string;
  componentName: string;           // "front_clip", "driver_door", "engine"
  componentCategory: string;       // "body", "interior", "mechanical", "electrical"
  vehicleId: string;
  
  // Current state
  currentState: ComponentState;
  lastUpdated: string;
  
  // History of state changes
  stateHistory: ComponentStateChange[];
  
  // Cumulative totals across all sessions
  totalLaborHours: number;
  totalMaterialsCost: number;
  totalSessions: number;
  
  // Timeline span
  firstActivity: string;
  lastActivity: string;
  totalDaysSpan: number;
  
  // Completion tracking
  percentComplete: number;
  estimatedRemainingHours: number;
  
  // Linked work sessions
  linkedTimelineEventIds: string[];
}

interface VehicleRestorationOverview {
  vehicleId: string;
  components: ComponentLifecycle[];
  
  // Rollup totals
  totalLaborHours: number;
  totalMaterialsCost: number;
  totalTimelineSpanDays: number;
  
  // Progress
  componentsComplete: number;
  componentsInProgress: number;
  componentsPending: number;
  overallPercentComplete: number;
}

export class ComponentLifecycleTracker {
  
  /**
   * Analyze images to detect component state changes
   * This is called after images are grouped into a work session
   */
  static async analyzeWorkSession(
    vehicleId: string,
    imageIds: string[],
    sessionDate: string
  ): Promise<ComponentStateChange[]> {
    try {
      // Get images with existing analysis
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id, image_url, ai_scan_metadata, taken_at')
        .in('id', imageIds);
      
      if (!images || images.length === 0) return [];
      
      // Call AI to analyze component states in these images
      const { data, error } = await supabase.functions.invoke('analyze-component-states', {
        body: {
          vehicleId,
          imageIds,
          sessionDate,
          imageUrls: images.map(img => img.image_url)
        }
      });
      
      if (error) {
        console.warn('Component state analysis failed:', error);
        return [];
      }
      
      return data?.stateChanges || [];
      
    } catch (err) {
      console.error('Error analyzing work session:', err);
      return [];
    }
  }
  
  /**
   * Get the full lifecycle of a specific component
   */
  static async getComponentLifecycle(
    vehicleId: string,
    componentName: string
  ): Promise<ComponentLifecycle | null> {
    try {
      const { data, error } = await supabase
        .from('component_lifecycles')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('component_name', componentName)
        .single();
      
      if (error || !data) return null;
      
      return data as ComponentLifecycle;
      
    } catch (err) {
      console.error('Error getting component lifecycle:', err);
      return null;
    }
  }
  
  /**
   * Get restoration overview for a vehicle
   * Shows all components and their states
   */
  static async getRestorationOverview(
    vehicleId: string
  ): Promise<VehicleRestorationOverview | null> {
    try {
      const { data: components, error } = await supabase
        .from('component_lifecycles')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('component_category', { ascending: true });
      
      if (error || !components) return null;
      
      // Calculate rollups
      const totalLaborHours = components.reduce((sum, c) => sum + (c.total_labor_hours || 0), 0);
      const totalMaterialsCost = components.reduce((sum, c) => sum + (c.total_materials_cost || 0), 0);
      
      const complete = components.filter(c => c.current_state === 'complete').length;
      const inProgress = components.filter(c => 
        c.current_state !== 'complete' && c.current_state !== 'original'
      ).length;
      const pending = components.filter(c => c.current_state === 'original').length;
      
      // Calculate time span
      const firstDates = components
        .map(c => c.first_activity)
        .filter(Boolean)
        .sort();
      const lastDates = components
        .map(c => c.last_activity)
        .filter(Boolean)
        .sort()
        .reverse();
      
      let totalDays = 0;
      if (firstDates.length > 0 && lastDates.length > 0) {
        totalDays = Math.ceil(
          (new Date(lastDates[0]).getTime() - new Date(firstDates[0]).getTime()) / (1000 * 60 * 60 * 24)
        );
      }
      
      return {
        vehicleId,
        components: components as ComponentLifecycle[],
        totalLaborHours,
        totalMaterialsCost,
        totalTimelineSpanDays: totalDays,
        componentsComplete: complete,
        componentsInProgress: inProgress,
        componentsPending: pending,
        overallPercentComplete: components.length > 0 
          ? Math.round((complete / components.length) * 100) 
          : 0
      };
      
    } catch (err) {
      console.error('Error getting restoration overview:', err);
      return null;
    }
  }
  
  /**
   * Update component state when new work is detected
   */
  static async updateComponentState(
    vehicleId: string,
    componentName: string,
    newState: ComponentState,
    workSession: {
      timestamp: string;
      imageIds: string[];
      laborHours: number;
      materials: Array<{ name: string; cost: number }>;
      notes: string;
      confidence: number;
      timelineEventId?: string;
    }
  ): Promise<boolean> {
    try {
      // Get or create component lifecycle
      let { data: existing } = await supabase
        .from('component_lifecycles')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('component_name', componentName)
        .single();
      
      const stateChange: ComponentStateChange = {
        componentId: existing?.id || '',
        componentName,
        fromState: existing?.current_state || 'original',
        toState: newState,
        timestamp: workSession.timestamp,
        imageIds: workSession.imageIds,
        laborHours: workSession.laborHours,
        materials: workSession.materials,
        notes: workSession.notes,
        confidence: workSession.confidence
      };
      
      if (existing) {
        // Update existing
        const updatedHistory = [...(existing.state_history || []), stateChange];
        const linkedEvents = [...(existing.linked_timeline_event_ids || [])];
        if (workSession.timelineEventId) {
          linkedEvents.push(workSession.timelineEventId);
        }
        
        await supabase
          .from('component_lifecycles')
          .update({
            current_state: newState,
            state_history: updatedHistory,
            total_labor_hours: (existing.total_labor_hours || 0) + workSession.laborHours,
            total_materials_cost: (existing.total_materials_cost || 0) + 
              workSession.materials.reduce((sum, m) => sum + m.cost, 0),
            total_sessions: (existing.total_sessions || 0) + 1,
            last_activity: workSession.timestamp,
            linked_timeline_event_ids: linkedEvents,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new
        await supabase
          .from('component_lifecycles')
          .insert({
            vehicle_id: vehicleId,
            component_name: componentName,
            component_category: this.inferCategory(componentName),
            current_state: newState,
            state_history: [stateChange],
            total_labor_hours: workSession.laborHours,
            total_materials_cost: workSession.materials.reduce((sum, m) => sum + m.cost, 0),
            total_sessions: 1,
            first_activity: workSession.timestamp,
            last_activity: workSession.timestamp,
            linked_timeline_event_ids: workSession.timelineEventId ? [workSession.timelineEventId] : []
          });
      }
      
      return true;
      
    } catch (err) {
      console.error('Error updating component state:', err);
      return false;
    }
  }
  
  /**
   * Infer component category from name
   */
  private static inferCategory(componentName: string): string {
    const name = componentName.toLowerCase();
    
    if (['hood', 'fender', 'door', 'quarter', 'roof', 'floor', 'rocker', 'bumper', 'grille', 'front_clip', 'rear_clip', 'cab'].some(c => name.includes(c))) {
      return 'body';
    }
    if (['seat', 'dash', 'carpet', 'headliner', 'door_panel', 'console', 'steering'].some(c => name.includes(c))) {
      return 'interior';
    }
    if (['engine', 'transmission', 'differential', 'axle', 'brake', 'suspension', 'exhaust', 'intake'].some(c => name.includes(c))) {
      return 'mechanical';
    }
    if (['wiring', 'harness', 'gauge', 'light', 'radio', 'ac', 'heater'].some(c => name.includes(c))) {
      return 'electrical';
    }
    if (['wheel', 'tire', 'hub'].some(c => name.includes(c))) {
      return 'wheels_tires';
    }
    if (['glass', 'windshield', 'mirror'].some(c => name.includes(c))) {
      return 'glass';
    }
    if (['paint', 'primer', 'clearcoat', 'color'].some(c => name.includes(c))) {
      return 'paint';
    }
    
    return 'other';
  }
  
  /**
   * Find "loose ends" - components started but not completed
   * AI can use context to help tie these up
   */
  static async findLooseEnds(vehicleId: string): Promise<ComponentLifecycle[]> {
    try {
      const { data, error } = await supabase
        .from('component_lifecycles')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .not('current_state', 'in', '("original", "complete")')
        .order('last_activity', { ascending: true }); // Oldest first = most stale
      
      if (error) return [];
      
      return data as ComponentLifecycle[];
      
    } catch (err) {
      console.error('Error finding loose ends:', err);
      return [];
    }
  }
  
  /**
   * AI-assisted: Try to tie up loose ends by analyzing recent images
   * "Hey, this image shows front clip installed - that was removed 6 months ago"
   */
  static async suggestLooseEndResolutions(
    vehicleId: string,
    recentImageIds: string[]
  ): Promise<Array<{
    component: string;
    currentState: ComponentState;
    suggestedNewState: ComponentState;
    evidence: string[];
    confidence: number;
  }>> {
    try {
      const looseEnds = await this.findLooseEnds(vehicleId);
      if (looseEnds.length === 0) return [];
      
      // Call AI to check if recent images show resolution of loose ends
      const { data, error } = await supabase.functions.invoke('resolve-loose-ends', {
        body: {
          vehicleId,
          looseEnds: looseEnds.map(le => ({
            componentName: le.componentName,
            currentState: le.currentState,
            lastActivity: le.lastActivity,
            stateHistory: le.stateHistory
          })),
          recentImageIds
        }
      });
      
      if (error) return [];
      
      return data?.suggestions || [];
      
    } catch (err) {
      console.error('Error suggesting loose end resolutions:', err);
      return [];
    }
  }
}

