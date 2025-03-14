/**
 * Vehicle Timeline Actions Hook
 * 
 * Provides specialized actions for the Vehicle Timeline component,
 * following the established multi-source connector framework and 
 * confidence-based data resolution patterns.
 */

import { useCallback, useState } from 'react';
import { useButtonActions } from '@/utils/button-actions';
import { TimelineEvent } from './index';

// Timeline-specific action types
export type TimelineSource = 'bat' | 'nhtsa' | 'user' | 'service_records' | 'mecum' | 'barrett_jackson';

export interface TimelineActionOptions {
  requireAuth?: boolean;
  showConfirmation?: boolean;
  notifyOnComplete?: boolean;
}

export function useTimelineActions(vehicleId?: string) {
  const { executeDbAction, toast, navigateTo, supabase } = useButtonActions();
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<Partial<TimelineEvent> | null>(null);
  
  /**
   * Add a new event to the vehicle timeline
   */
  const addTimelineEvent = useCallback(async (
    event: Omit<TimelineEvent, 'id'>,
    options: TimelineActionOptions = {}
  ) => {
    return executeDbAction(
      'Add Timeline Event',
      async () => {
        // First check if the vehicle exists
        if (!event.vehicleId) {
          throw new Error('Vehicle ID is required');
        }
        
        const { data: vehicleExists, error: vehicleError } = await supabase
          .from('vehicles')
          .select('id')
          .eq('id', event.vehicleId)
          .single();
          
        if (vehicleError || !vehicleExists) {
          throw new Error('Vehicle not found');
        }
        
        // Format the event for database insertion
        const dbEvent = {
          vehicle_id: event.vehicleId,
          event_type: event.eventType,
          source: event.eventSource,
          event_date: event.eventDate,
          title: event.title,
          description: event.description || null,
          confidence_score: event.confidenceScore,
          metadata: event.metadata || {},
          source_url: event.sourceUrl || null,
          image_urls: event.imageUrls || []
        };
        
        return supabase
          .from('vehicle_timeline_events')
          .insert(dbEvent)
          .select()
          .single();
      },
      {
        successMessage: options.notifyOnComplete ? 'Timeline event added successfully' : undefined,
        onSuccess: () => {
          setIsAddingEvent(false);
          setCurrentEvent(null);
        }
      }
    );
  }, [executeDbAction, supabase]);
  
  /**
   * Update an existing timeline event
   */
  const updateTimelineEvent = useCallback(async (
    eventId: string,
    updates: Partial<TimelineEvent>,
    options: TimelineActionOptions = {}
  ) => {
    return executeDbAction(
      'Update Timeline Event',
      async () => {
        // Format updates for database
        const dbUpdates: Record<string, any> = {};
        
        if (updates.eventType) dbUpdates.event_type = updates.eventType;
        if (updates.eventSource) dbUpdates.source = updates.eventSource;
        if (updates.eventDate) dbUpdates.event_date = updates.eventDate;
        if (updates.title) dbUpdates.title = updates.title;
        if (updates.description !== undefined) dbUpdates.description = updates.description;
        if (updates.confidenceScore !== undefined) dbUpdates.confidence_score = updates.confidenceScore;
        if (updates.metadata) dbUpdates.metadata = updates.metadata;
        if (updates.sourceUrl !== undefined) dbUpdates.source_url = updates.sourceUrl;
        if (updates.imageUrls) dbUpdates.image_urls = updates.imageUrls;
        
        return supabase
          .from('vehicle_timeline_events')
          .update(dbUpdates)
          .eq('id', eventId)
          .select()
          .single();
      },
      {
        successMessage: options.notifyOnComplete ? 'Timeline event updated successfully' : undefined
      }
    );
  }, [executeDbAction, supabase]);
  
  /**
   * Delete a timeline event
   */
  const deleteTimelineEvent = useCallback(async (
    eventId: string,
    options: TimelineActionOptions = {}
  ) => {
    return executeDbAction(
      'Delete Timeline Event',
      async () => {
        return supabase
          .from('vehicle_timeline_events')
          .delete()
          .eq('id', eventId);
      },
      {
        successMessage: options.notifyOnComplete ? 'Timeline event deleted successfully' : undefined
      }
    );
  }, [executeDbAction, supabase]);
  
  /**
   * Export timeline events to CSV
   */
  const exportTimeline = useCallback(async (events: TimelineEvent[]) => {
    if (!events || events.length === 0) {
      toast({
        title: "Export Failed",
        description: "No events to export",
        variant: "destructive",
      });
      return;
    }
    
    try {
      // Format events for CSV
      const header = ["Date", "Type", "Title", "Description", "Source", "Confidence"];
      const rows = events.map(event => [
        new Date(event.eventDate).toLocaleDateString(),
        event.eventType,
        event.title,
        event.description || '',
        event.eventSource,
        `${event.confidenceScore}%`
      ]);
      
      // Combine header and rows
      const csvContent = [
        header.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      
      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `vehicle_timeline_${vehicleId ? vehicleId : 'export'}_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      
      // Trigger download and cleanup
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Export Successful",
        description: `Exported ${events.length} timeline events`,
      });
    } catch (error) {
      console.error('Error exporting timeline:', error);
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export timeline",
        variant: "destructive",
      });
    }
  }, [toast, vehicleId]);
  
  /**
   * Enriches a vehicle timeline with data from external sources
   * Leverages the multi-source connector framework
   */
  const enrichTimelineData = useCallback(async (vin?: string, vehicleIdParam?: string) => {
    const targetVehicleId = vehicleIdParam || vehicleId;
    
    if (!vin && !targetVehicleId) {
      toast({
        title: "Enrichment Failed",
        description: "VIN or vehicle ID is required",
        variant: "destructive",
      });
      return;
    }
    
    return executeDbAction(
      'Enrich Timeline',
      async () => {
        // First determine which vehicle to enrich
        let query;
        
        if (targetVehicleId) {
          query = { id: targetVehicleId };
        } else if (vin) {
          query = { vin };
        } else {
          throw new Error('Either VIN or vehicle ID is required');
        }
        
        // Invoke the enrichment function (Edge Function in Supabase)
        return supabase.functions.invoke('enrich-vehicle-timeline', {
          body: { query }
        });
      },
      {
        successMessage: "Timeline enriched with additional data sources",
        errorMessage: "Failed to enrich timeline data"
      }
    );
  }, [executeDbAction, supabase, toast, vehicleId]);
  
  // Provide an organized set of actions
  return {
    // State
    isAddingEvent,
    setIsAddingEvent,
    currentEvent,
    setCurrentEvent,
    
    // Actions
    addTimelineEvent,
    updateTimelineEvent,
    deleteTimelineEvent,
    exportTimeline,
    enrichTimelineData,
    
    // Navigation
    navigateToVehicleDetails: (id: string) => navigateTo(`/vehicles/${id}`),
    navigateToSource: (sourceUrl?: string) => {
      if (sourceUrl) {
        window.open(sourceUrl, '_blank', 'noopener,noreferrer');
      }
    },
    
    // Utilities from base button actions
    toast
  };
}
