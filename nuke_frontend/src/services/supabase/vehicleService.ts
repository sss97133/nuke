import { supabase } from '../../lib/supabase';
import type { Vehicle } from '../../types';

export const vehicleService = {
  /**
   * Get a single vehicle by ID
   */
  getById: async (id: string) => {
    // Fetch vehicle and images separately to avoid PostgREST ambiguity (vehicle_id + suggested_vehicle_id)
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', id)
      .single();

    if (vehicleError) throw vehicleError;
    
    // Fetch images separately
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('*')
      .eq('vehicle_id', id);

    if (imagesError) throw imagesError;
    
    // Transform images to standard format if needed
    const transformedImages = (images || []).map((img: any) => ({
      ...img,
      url: img.image_url || img.url
    }));

    return {
      ...vehicle,
      images: transformedImages
    } as Vehicle;
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
    // Fetch vehicles and images separately to avoid PostgREST ambiguity
    let vehicleQuery = supabase
      .from('vehicles')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (userId) {
      vehicleQuery = vehicleQuery.eq('user_id', userId);
    }

    const { data: vehicles, error: vehiclesError } = await vehicleQuery;

    if (vehiclesError) throw vehiclesError;
    
    if (!vehicles || vehicles.length === 0) {
      return [] as Vehicle[];
    }
    
    // Fetch images for all vehicles
    const vehicleIds = vehicles.map(v => v.id);
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('*')
      .in('vehicle_id', vehicleIds);

    if (imagesError) throw imagesError;
    
    // Group images by vehicle_id
    const imagesByVehicle = new Map<string, any[]>();
    (images || []).forEach(img => {
      if (!imagesByVehicle.has(img.vehicle_id)) {
        imagesByVehicle.set(img.vehicle_id, []);
      }
      imagesByVehicle.get(img.vehicle_id)!.push(img);
    });
    
    // Attach images to vehicles
    return vehicles.map(vehicle => ({
      ...vehicle,
      images: imagesByVehicle.get(vehicle.id) || []
    })) as Vehicle[];
  }
};

