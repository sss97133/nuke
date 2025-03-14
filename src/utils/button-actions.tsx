/**
 * Button Actions Utility
 * 
 * A comprehensive approach to standardize button functionality across the app
 * Integrates with existing component-based architecture for vehicle history tracking
 */

import { useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { atom, useAtom } from 'jotai';
import { createClient } from '@supabase/supabase-js';
import { SupabaseError } from '@/utils/supabase-helpers';

// Button implementation status tracking
interface ButtonMetadata {
  component: string;
  name: string;
  description: string;
  status: 'implemented' | 'in-progress' | 'planned';
  lastTested?: Date;
  requiresAuth: boolean;
  apiEndpoint?: string;
}

// Global state to track button metadata
const buttonRegistryAtom = atom<Record<string, ButtonMetadata>>({});

// Environment-aware Supabase client instantiation
export const getSupabaseClient = () => {
  // Following the established fallback mechanism pattern
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 
                     (typeof window !== 'undefined' && window.__env?.VITE_SUPABASE_URL) || 
                     process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 
                         (typeof window !== 'undefined' && window.__env?.VITE_SUPABASE_ANON_KEY) || 
                         process.env.VITE_SUPABASE_ANON_KEY;
                         
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new SupabaseError('Missing Supabase credentials');
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
};

// Component domains for standardized button actions
export type ComponentDomain = 
  | 'global'
  | 'timeline'
  | 'vehicle'
  | 'auth'
  | 'dashboard'
  | 'marketplace'
  | 'professional'
  | 'sitemap'
  | 'token';

/**
 * A hook to manage standardized button actions
 */
export function useButtonActions() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [buttonRegistry, setButtonRegistry] = useAtom(buttonRegistryAtom);
  const supabase = getSupabaseClient();
  
  /**
   * Register a button in the global registry
   */
  const registerButton = useCallback((metadata: ButtonMetadata) => {
    const id = `${metadata.component}:${metadata.name}`;
    
    setButtonRegistry(prev => ({
      ...prev,
      [id]: metadata
    }));
    
    return id;
  }, [setButtonRegistry]);
  
  /**
   * Navigation with implementation check and logging
   */
  const navigateTo = useCallback((
    path: string, 
    implemented = true, 
    options: { replace?: boolean; state?: Record<string, unknown>; trackAs?: string } = {}
  ) => {
    // Log the navigation attempt for better debugging and analytics
    const action = options.trackAs || `navigate:${path}`;
    const component = window.location.pathname;
    
    // Use debug tracking from button-debug.ts if it exists
    if (typeof window.trackButtonAction === 'function') {
      window.trackButtonAction({
        action,
        component,
        status: implemented ? 'success' : 'not-implemented',
        data: { path, implemented }
      });
    }
    
    if (!implemented) {
      toast({
        title: "Feature Not Available",
        description: "This feature is currently under development",
        variant: "destructive",
      });
      return;
    }
    
    navigate(path, { replace: options.replace, state: options.state });
  }, [navigate, toast]);
  
  /**
   * Execute a database action with proper error handling
   */
  const executeDbAction = useCallback(async <T,>(
    actionName: string,
    action: () => Promise<{data: T | null, error: Error | null}>,
    options: {
      successMessage?: string;
      errorMessage?: string;
      onSuccess?: (data: T) => void;
      onError?: (error: Error) => void;
    } = {}
  ) => {
    try {
      const { data, error } = await action();
      
      if (error) {
        console.error(`Error in ${actionName}:`, error);
        toast({
          title: "Error",
          description: options.errorMessage || error.message || `Failed to ${actionName}`,
          variant: "destructive",
        });
        
        options.onError?.(error);
        return { success: false, data: null, error };
      }
      
      if (options.successMessage) {
        toast({
          title: "Success",
          description: options.successMessage,
        });
      }
      
      options.onSuccess?.(data as T);
      return { success: true, data, error: null };
    } catch (err) {
      const error = err as Error;
      console.error(`Exception in ${actionName}:`, error);
      
      toast({
        title: "Error",
        description: options.errorMessage || error.message || `Failed to ${actionName}`,
        variant: "destructive",
      });
      
      options.onError?.(error);
      return { success: false, data: null, error };
    }
  }, [toast]);
  
  /**
   * Handle form submission with validation
   */
  const handleFormSubmit = useCallback(async <T extends Record<string, unknown>>(
    formData: T,
    validationFn: (data: T) => { valid: boolean; errors?: Record<string, string> },
    submitFn: (validData: T) => Promise<void>,
    options: {
      successMessage?: string;
      onValidationError?: (errors: Record<string, string>) => void;
    } = {}
  ) => {
    const validation = validationFn(formData);
    
    if (!validation.valid) {
      options.onValidationError?.(validation.errors || {});
      return false;
    }
    
    try {
      await submitFn(formData);
      
      if (options.successMessage) {
        toast({
          title: "Success",
          description: options.successMessage,
        });
      }
      
      return true;
    } catch (error) {
      console.error("Form submission error:", error);
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit form",
        variant: "destructive",
      });
      
      return false;
    }
  }, [toast]);
  
  // Predefined action sets for common components
  const siteMapActions = {
    vehicleManagement: { path: '/vehicles', implemented: true },
    inventory: { path: '/inventory', implemented: true },
    tokenManagement: { path: '/token-management', implemented: false },
    daoGovernance: { path: '/dao-governance', implemented: false },
    vehicleTokens: { path: '/vehicle-tokens', implemented: false },
    daoProposals: { path: '/proposals', implemented: false },
    terminal: { path: '/terminal', implemented: true },
    service: { path: '/service', implemented: true },
    mapView: { path: '/garages', implemented: true },
    professional: { path: '/professional', implemented: false },
    analytics: { path: '/analytics', implemented: false },
    marketplace: { path: '/marketplace', implemented: true },
    certifications: { path: '/certifications', implemented: true },
    settings: { path: '/settings', implemented: true },
    profile: { path: '/profile', implemented: true },
    helpAndSupport: { path: '/help', implemented: true },
    admin: { path: '/admin', implemented: false },
  };

  const menuActions = {
    sitemap: { path: '/dashboard/sitemap', implemented: true },
    glossary: { path: '/dashboard/glossary', implemented: true },
    documentation: { path: '/dashboard/documentation', implemented: true },
    tokenManagement: { path: '/dashboard/token-management', implemented: false },
    daoGovernance: { path: '/dashboard/dao-governance', implemented: false },
    professional: { path: '/dashboard/professional', implemented: false },
    vinScanner: { path: '/dashboard/vin-scanner', implemented: true },
    marketAnalysis: { path: '/dashboard/market-analysis', implemented: false },
    export: { implemented: false, action: 'export' },
    settings: { path: '/dashboard/settings', implemented: true },
    help: { path: '/dashboard/help', implemented: true },
    logout: { implemented: true, action: 'logout' },
  };

  return {
    // Button registration
    registerButton,
    
    // Navigation
    navigateTo,
    
    // Database operations
    executeDbAction,
    handleFormSubmit,
    
    // Action sets for components
    siteMapActions,
    menuActions,
    
    // Utilities
    supabase,
    toast
  };
}

/**
 * A specialized hook for vehicle timeline actions
 * Follows the established connector framework pattern
 */
export function useVehicleTimelineActions() {
  const { executeDbAction, toast } = useButtonActions();
  
  // Update vehicle timeline with proper confidence scoring
  const updateTimeline = useCallback(async (
    vehicleId: string,
    event: {
      eventType: string;
      timestamp: Date;
      description: string;
      sourceId: string;
      confidence: number;
      metadata?: Record<string, any>;
    }
  ) => {
    return executeDbAction(
      'Update Timeline',
      async () => {
        const supabase = getSupabaseClient();
        return supabase
          .from('vehicle_timeline_events')
          .insert({
            vehicle_id: vehicleId,
            event_type: event.eventType,
            timestamp: event.timestamp.toISOString(),
            description: event.description,
            source_id: event.sourceId,
            confidence_score: event.confidence,
            metadata: event.metadata || {}
          });
      },
      {
        successMessage: 'Timeline updated successfully',
        errorMessage: 'Failed to update vehicle timeline'
      }
    );
  }, [executeDbAction]);
  
  // Vehicle data aggregation from multiple sources with confidence-based resolution
  const aggregateVehicleData = useCallback(async (vehicleId: string) => {
    return executeDbAction(
      'Aggregate Vehicle Data',
      async () => {
        const supabase = getSupabaseClient();
        
        // First, get all timeline events for this vehicle
        const { data: events, error: eventsError } = await supabase
  if (error) console.error("Database query error:", error);
          
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('timestamp', { ascending: false });
          
        if (eventsError) return { data: null, error: eventsError };
        
        // Then get basic vehicle info
        const { data: vehicle, error: vehicleError } = await supabase
  if (error) console.error("Database query error:", error);
          
          .select('*')
          .eq('id', vehicleId)
          .single();
          
        if (vehicleError) return { data: null, error: vehicleError };
        
        // Process and return the aggregated data
        return { 
          data: {
            vehicle,
            timeline: events,
            // Add computed properties that integrate multiple data sources
            aggregated: {
              lastKnownValue: calculateLatestValue(events),
              ownershipHistory: extractOwnershipHistory(events),
              maintenanceStatus: computeMaintenanceStatus(events)
            }
          }, 
          error: null 
        };
      }
    );
  }, [executeDbAction]);
  
  return {
    updateTimeline,
    aggregateVehicleData,
    toast
  };
}

// Helper functions for data processing
function calculateLatestValue(events: any[]): number {
  // Find the most recent valuation event with highest confidence
  const valuationEvents = events
    .filter(e => e.event_type === 'valuation')
    .sort((a, b) => {
      // Sort by timestamp (most recent first)
      const timeComparison = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (timeComparison !== 0) return timeComparison;
      
      // If same timestamp, use confidence as tiebreaker
      return b.confidence_score - a.confidence_score;
    });
    
  return valuationEvents.length > 0 
    ? (valuationEvents[0].metadata?.value || 0) 
    : 0;
}

function extractOwnershipHistory(events: any[]): any[] {
  // Extract ownership changes from timeline
  return events
    .filter(e => e.event_type === 'ownership_change')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map(e => ({
      date: e.timestamp,
      owner: e.metadata?.owner || 'Unknown',
      source: e.source_id,
      confidence: e.confidence_score
    }));
}

function computeMaintenanceStatus(events: any[]): {
  status: 'good' | 'due' | 'overdue' | 'unknown';
  lastService?: Date;
  nextRecommended?: Date;
} {
  // Find the most recent maintenance event
  const maintenanceEvents = events
    .filter(e => e.event_type === 'maintenance')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
  if (maintenanceEvents.length === 0) {
    return { status: 'unknown' };
  }
  
  const lastService = new Date(maintenanceEvents[0].timestamp);
  const nextRecommended = new Date(lastService);
  nextRecommended.setMonth(nextRecommended.getMonth() + 6); // Assume 6 month interval
  
  const now = new Date();
  
  if (now > nextRecommended) {
    return {
      status: 'overdue',
      lastService,
      nextRecommended
    };
  } else if (now > new Date(nextRecommended.getTime() - 30 * 24 * 60 * 60 * 1000)) {
    return {
      status: 'due',
      lastService,
      nextRecommended
    };
  } else {
    return {
      status: 'good',
      lastService,
      nextRecommended
    };
  }
}
