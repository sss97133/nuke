import { supabase } from '../../lib/supabase';
import type { TimelineEvent } from '../../types';

export const timelineService = {
  /**
   * Get all timeline events for a vehicle
   */
  getByVehicleId: async (vehicleId: string) => {
    const { data, error } = await supabase
      .from('timeline_events')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('event_date', { ascending: false });

    if (error) throw error;
    return data as TimelineEvent[];
  },

  /**
   * Create a new timeline event
   */
  create: async (eventData: Partial<TimelineEvent>) => {
    // Ensure user_id is set
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const payload = {
      ...eventData,
      user_id: eventData.user_id || userId,
      source: eventData.source || 'user_input',
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('timeline_events')
      .insert([payload])
      .select()
      .single();

    if (error) throw error;
    return data as TimelineEvent;
  },

  /**
   * Verify an event
   */
  verify: async (eventId: string) => {
    const { data, error } = await supabase
      .from('timeline_events')
      .update({ verified: true })
      .eq('id', eventId)
      .select()
      .single();

    if (error) throw error;
    return data as TimelineEvent;
  },

  /**
   * Update an event
   */
  update: async (eventId: string, updates: Partial<TimelineEvent>) => {
    const { data, error } = await supabase
      .from('timeline_events')
      .update(updates)
      .eq('id', eventId)
      .select()
      .single();

    if (error) throw error;
    return data as TimelineEvent;
  },

  /**
   * Delete an event
   */
  delete: async (eventId: string) => {
    const { error } = await supabase
      .from('timeline_events')
      .delete()
      .eq('id', eventId);

    if (error) throw error;
    return true;
  }
};

