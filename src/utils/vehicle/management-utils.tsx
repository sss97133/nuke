import { supabase } from '@/integrations/supabase/client';
import type { VehicleWithId } from './types';

/**
 * Creates a new vehicle record in the database
 */
export const createVehicle = async (vehicleData: Omit<VehicleWithId, 'id' | 'created_at' | 'updated_at'>) => {
  const { data, error } = await supabase
    .from('vehicles')
    .insert([vehicleData])
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Updates an existing vehicle record
 */
export const updateVehicle = async (id: string, vehicleData: Partial<VehicleWithId>) => {
  const { data, error } = await supabase
    .from('vehicles')
    .update({
      ...vehicleData,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Deletes a vehicle record
 */
export const deleteVehicle = async (id: string) => {
  const { error } = await supabase
    .from('vehicles')
    .delete()
    .eq('id', id);

  if (error) throw error;
};

/**
 * Retrieves a vehicle by ID
 */
export const getVehicleById = async (id: string) => {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
};

/**
 * Retrieves all vehicles for the current user
 */
export const getUserVehicles = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
};
