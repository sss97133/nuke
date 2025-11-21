// Timeline Events Hook
// Manage vehicle timeline events with confidence scoring and verification

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface TimelineEvent {
  id: string;
  vehicle_id: string;
  user_id: string;
  event_type: 'purchase' | 'sale' | 'registration' | 'inspection' | 'maintenance' | 
             'repair' | 'modification' | 'accident' | 'insurance_claim' | 'recall' |
             'ownership_transfer' | 'lien_change' | 'title_update' | 'mileage_reading';
  event_category: 'ownership' | 'maintenance' | 'legal' | 'performance' | 'cosmetic' | 'safety';
  title: string;
  description?: string;
  event_date: string;
  mileage_at_event?: number;
  location?: string;
  source_type: 'user_input' | 'service_record' | 'government_record' | 'insurance_record' |
               'dealer_record' | 'manufacturer_recall' | 'inspection_report' | 'receipt';
  confidence_score: number;
  verification_status: 'unverified' | 'user_verified' | 'professional_verified' | 'multi_verified' | 'disputed';
  documentation_urls?: string[];
  receipt_amount?: number;
  receipt_currency?: string;
  metadata?: Record<string, any>;
  affects_value: boolean;
  affects_safety: boolean;
  affects_performance: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimelineEventVerification {
  id: string;
  timeline_event_id: string;
  verifier_id: string;
  verification_type: 'owner_confirmation' | 'professional_inspection' | 'document_review' |
                    'cross_reference' | 'third_party_validation';
  verification_status: 'verified' | 'disputed' | 'needs_review' | 'insufficient_evidence';
  confidence_adjustment: number;
  notes?: string;
  supporting_evidence?: string[];
  professional_license?: string;
  professional_type?: 'mechanic' | 'appraiser' | 'inspector' | 'dealer' | 'insurance_adjuster';
  created_at: string;
}

export interface TimelineEventConflict {
  id: string;
  primary_event_id: string;
  conflicting_event_id: string;
  conflict_type: 'date_mismatch' | 'mileage_inconsistency' | 'duplicate_event' | 'contradictory_info';
  conflict_description: string;
  resolution_status: 'unresolved' | 'resolved' | 'accepted_discrepancy' | 'merged_events';
  resolution_notes?: string;
  created_at: string;
}

export const useTimelineEvents = (vehicleId?: string) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [verifications, setVerifications] = useState<TimelineEventVerification[]>([]);
  const [conflicts, setConflicts] = useState<TimelineEventConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTimelineEvents = async () => {
    if (!vehicleId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Load timeline events
      const { data: eventsData, error: eventsError } = await supabase
        .from('vehicle_timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (eventsError) throw eventsError;

      // Load verifications for these events
      const eventIds = eventsData?.map(e => e.id) || [];
      const { data: verificationsData, error: verificationsError } = await supabase
        .from('timeline_event_verifications')
        .select('*')
        .in('timeline_event_id', eventIds);

      if (verificationsError) throw verificationsError;

      // Load conflicts for these events
      const { data: conflictsData, error: conflictsError } = await supabase
        .from('timeline_event_conflicts')
        .select('*')
        .or(`primary_event_id.in.(${eventIds.join(',')}),conflicting_event_id.in.(${eventIds.join(',')})`);

      if (conflictsError) throw conflictsError;

      setEvents(eventsData || []);
      setVerifications(verificationsData || []);
      setConflicts(conflictsData || []);
      
    } catch (err) {
      console.error('Error loading timeline events:', err);
      setError(err instanceof Error ? err.message : 'Failed to load timeline events');
    } finally {
      setLoading(false);
    }
  };

  const createTimelineEvent = async (eventData: Partial<TimelineEvent>) => {
    if (!vehicleId) return null;

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('vehicle_timeline_events')
        .insert({
          ...eventData,
          vehicle_id: vehicleId,
          user_id: userData.user.id,
          created_by: userData.user.id
        })
        .select()
        .single();

      if (error) throw error;

      // Refresh events after creation
      await loadTimelineEvents();
      
      return data;
    } catch (err) {
      console.error('Error creating timeline event:', err);
      setError(err instanceof Error ? err.message : 'Failed to create timeline event');
      return null;
    }
  };

  const updateTimelineEvent = async (eventId: string, updates: Partial<TimelineEvent>) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_timeline_events')
        .update(updates)
        .eq('id', eventId)
        .select()
        .single();

      if (error) throw error;

      // Refresh events after update
      await loadTimelineEvents();
      
      return data;
    } catch (err) {
      console.error('Error updating timeline event:', err);
      setError(err instanceof Error ? err.message : 'Failed to update timeline event');
      return null;
    }
  };

  const createVerification = async (verificationData: Partial<TimelineEventVerification>) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('timeline_event_verifications')
        .insert({
          ...verificationData,
          verifier_id: userData.user.id
        })
        .select()
        .single();

      if (error) throw error;

      // Refresh data after verification
      await loadTimelineEvents();
      
      return data;
    } catch (err) {
      console.error('Error creating verification:', err);
      setError(err instanceof Error ? err.message : 'Failed to create verification');
      return null;
    }
  };

  const resolveConflict = async (conflictId: string, resolution: {
    resolution_status: TimelineEventConflict['resolution_status'];
    resolution_method?: string;
    resolution_notes?: string;
  }) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('timeline_event_conflicts')
        .update({
          ...resolution,
          resolved_by: userData.user.id,
          resolved_at: new Date().toISOString()
        })
        .eq('id', conflictId)
        .select()
        .single();

      if (error) throw error;

      // Refresh data after resolution
      await loadTimelineEvents();
      
      return data;
    } catch (err) {
      console.error('Error resolving conflict:', err);
      setError(err instanceof Error ? err.message : 'Failed to resolve conflict');
      return null;
    }
  };

  useEffect(() => {
    loadTimelineEvents();
  }, [vehicleId]);

  // Helper functions for data analysis
  const getEventsByCategory = (category: TimelineEvent['event_category']) => {
    return events.filter(event => event.event_category === category);
  };

  const getVerifiedEvents = () => {
    return events.filter(event => 
      event.verification_status !== 'unverified' && 
      event.verification_status !== 'disputed'
    );
  };

  const getUnresolvedConflicts = () => {
    return conflicts.filter(conflict => conflict.resolution_status === 'unresolved');
  };

  const getEventVerifications = (eventId: string) => {
    return verifications.filter(v => v.timeline_event_id === eventId);
  };

  const getAverageConfidence = () => {
    if (events.length === 0) return 0;
    return events.reduce((sum, event) => sum + event.confidence_score, 0) / events.length;
  };

  return {
    events,
    verifications,
    conflicts,
    loading,
    error,
    refreshEvents: loadTimelineEvents,
    createTimelineEvent,
    updateTimelineEvent,
    createVerification,
    resolveConflict,
    // Helper functions
    getEventsByCategory,
    getVerifiedEvents,
    getUnresolvedConflicts,
    getEventVerifications,
    getAverageConfidence,
    // Statistics
    totalEvents: events.length,
    verifiedEventsCount: getVerifiedEvents().length,
    unresolvedConflictsCount: getUnresolvedConflicts().length,
    averageConfidence: getAverageConfidence()
  };
};
