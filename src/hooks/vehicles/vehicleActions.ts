import { useToast } from '@/hooks/use-toast';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { getStoredVehicleById } from './mockVehicleStorage';
import { PostgrestError } from '@supabase/supabase-js';
import { Dispatch, SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';

// Handler functions for vehicle interactions
export const handleVerify = async (id: number): Promise<void> => {
  try {
    const { error } = await supabase
      .from('vehicles')
      .update({ status: 'verified' })
      .eq('id', id);

    if (error) {
      throw error;
    }
    console.log(`Verified vehicle ${id}`);
  } catch (err) {
    const error = err as PostgrestError;
    console.error(`Error verifying vehicle ${id}:`, error.message);
    throw error;
  }
};

export const handleEdit = async (id: number): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    if (data) {
      console.log(`Editing vehicle ${id}:`, data);
      return data;
    } else {
      throw new Error(`Vehicle ${id} not found`);
    }
  } catch (err) {
    const error = err as PostgrestError;
    console.error(`Error editing vehicle ${id}:`, error.message);
    throw error;
  }
};

export const handleRemove = async (id: number): Promise<void> => {
  try {
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
    console.log(`Removed vehicle ${id}`);
  } catch (err) {
    const error = err as PostgrestError;
    console.error(`Error removing vehicle ${id}:`, error.message);
    throw error;
  }
};

export const toggleVehicleSelection = (
  id: number,
  selectedVehicles: number[],
  setSelectedVehicles: Dispatch<SetStateAction<number[]>>
): void => {
  if (selectedVehicles.includes(id)) {
    setSelectedVehicles(selectedVehicles.filter(vehicleId => vehicleId !== id));
  } else {
    setSelectedVehicles([...selectedVehicles, id]);
  }
};

// Bulk action handlers
export const handleBulkVerify = async (selectedVehicles: number[]): Promise<void> => {
  try {
    const { error } = await supabase
      .from('vehicles')
      .update({ status: 'verified' })
      .in('id', selectedVehicles);

    if (error) {
      throw error;
    }
    console.log(`Verified vehicles: ${selectedVehicles.join(', ')}`);
  } catch (err) {
    const error = err as PostgrestError;
    console.error(`Error bulk verifying vehicles:`, error.message);
    throw error;
  }
};

export const handleBulkAddToGarage = async (selectedVehicles: number[]): Promise<void> => {
  try {
    const { error } = await supabase
      .from('vehicles')
      .update({ status: 'owned' })
      .in('id', selectedVehicles);

    if (error) {
      throw error;
    }
    console.log(`Added vehicles to garage: ${selectedVehicles.join(', ')}`);
  } catch (err) {
    const error = err as PostgrestError;
    console.error(`Error bulk adding vehicles to garage:`, error.message);
    throw error;
  }
};

export const handleBulkRemove = async (selectedVehicles: number[]): Promise<void> => {
  try {
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .in('id', selectedVehicles);

    if (error) {
      throw error;
    }
    console.log(`Removed vehicles: ${selectedVehicles.join(', ')}`);
  } catch (err) {
    const error = err as PostgrestError;
    console.error(`Error bulk removing vehicles:`, error.message);
    throw error;
  }
};
