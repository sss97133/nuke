import { supabase } from '../../lib/supabase';
import type { Vehicle } from '../../types';

export const vehicleService = {
  /**
   * Get a single vehicle by ID
   */
  getById: async (id: string) => {
    const { data, error } = await supabase
      .from('vehicles')
      .select(`
        *,
        images:vehicle_images(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    
    // Transform images to standard format if needed
    if (data && data.images) {
      data.images = data.images.map((img: any) => ({
        ...img,
        url: img.image_url || img.url
      }));
    }

    return data as Vehicle;
  },

  /**
   * Create a new vehicle
   */
  create: async (vehicleData: Partial<Vehicle>) => {
    const { data, error } = await supabase
      .from('vehicles')
      .insert([vehicleData])
      .select()
      .single();

    if (error) throw error;
    return data as Vehicle;
  },

  /**
   * Update an existing vehicle
   */
  update: async (id: string, updates: Partial<Vehicle>) => {
    const { data, error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Vehicle;
  },

  /**
   * Archive a vehicle (soft delete)
   */
  archive: async (id: string) => {
    const { error } = await supabase
      .from('vehicles')
      .update({ status: 'archived' })
      .eq('id', id);

    if (error) throw error;
    return true;
  },

  /**
   * Get all vehicles for the current user (or public ones)
   */
  list: async (userId?: string) => {
    let query = supabase
      .from('vehicles')
      .select(`
        *,
        images:vehicle_images(*)
      `)
      .order('created_at', { ascending: false });
      
    if (userId) {
      query = query.eq('user_id', userId); // Assuming user_id or owner_id column
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data || []) as Vehicle[];
  }
};

