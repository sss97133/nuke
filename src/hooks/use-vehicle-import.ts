import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import Papa from 'papaparse';
import type { Database } from '@/types/database';
import { PostgrestError } from '@supabase/supabase-js';

type Vehicle = Database['public']['Tables']['vehicles']['Row'];
type VehicleCollection = Database['public']['Tables']['vehicle_collections']['Row'];

interface ImportOptions {
  collectionId?: string;
  isDiscovered?: boolean;
  source?: string;
  sourceUrl?: string;
  sourceData?: Record<string, unknown>;
}

export const useVehicleImport = () => {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const createCollection = async (name: string, description?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('vehicle_collections')
        .insert({
          user_id: user.id,
          name,
          description,
          is_private: false,
          tags: []
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      const error = err as Error;
      console.error('Error creating collection:', error);
      toast({
        title: 'Error',
        description: 'Failed to create collection',
        variant: 'destructive'
      });
      return null;
    }
  };

  const importFromCsv = async (file: File, options: ImportOptions = {}) => {
    setIsImporting(true);
    setProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Parse CSV
      const results = await new Promise<Record<string, string>[]>((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data as Record<string, string>[]),
          error: (error) => reject(error)
        });
      });

      const vehicles: Partial<Vehicle>[] = results.map(row => ({
        user_id: user.id,
        make: row.make,
        model: row.model,
        year: parseInt(row.year),
        vin: row.vin,
        color: row.color,
        purchase_date: row.purchase_date,
        purchase_price: parseFloat(row.purchase_price),
        current_value: parseFloat(row.current_value),
        mileage: parseInt(row.mileage),
        condition: row.condition,
        location: row.location,
        license_plate: row.license_plate,
        insurance_policy: row.insurance_policy,
        notes: row.notes,
        status: 'active',
        collection_id: options.collectionId,
        is_discovered: options.isDiscovered || false,
        source: options.source,
        source_url: options.sourceUrl,
        source_data: options.sourceData
      }));

      // Batch insert vehicles
      const { data, error } = await supabase
        .from('vehicles')
        .insert(vehicles)
        .select();

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Imported ${data.length} vehicles`
      });

      return data;
    } catch (err) {
      const error = err as Error;
      console.error('Error importing vehicles:', error);
      toast({
        title: 'Error',
        description: 'Failed to import vehicles',
        variant: 'destructive'
      });
      return null;
    } finally {
      setIsImporting(false);
      setProgress(0);
    }
  };

  const importFromCraigslist = async (urls: string[]) => {
    setIsImporting(true);
    setProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Create a collection for Craigslist finds
      const collection = await createCollection('Craigslist Finds');
      if (!collection) throw new Error('Failed to create collection');

      // Process each URL
      const vehicles = await Promise.all(
        urls.map(async (url) => {
          // Here you would implement the actual Craigslist scraping
          // For now, we'll create a placeholder vehicle
          return {
            user_id: user.id,
            make: 'Unknown',
            model: 'Unknown',
            year: new Date().getFullYear(),
            status: 'active',
            collection_id: collection.id,
            is_discovered: true,
            source: 'craigslist',
            source_url: url,
            source_data: { url }
          };
        })
      );

      // Batch insert vehicles
      const { data, error } = await supabase
        .from('vehicles')
        .insert(vehicles)
        .select();

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Imported ${data.length} vehicles from Craigslist`
      });

      return data;
    } catch (err) {
      const error = err as Error;
      console.error('Error importing from Craigslist:', error);
      toast({
        title: 'Error',
        description: 'Failed to import from Craigslist',
        variant: 'destructive'
      });
      return null;
    } finally {
      setIsImporting(false);
      setProgress(0);
    }
  };

  return {
    isImporting,
    progress,
    importFromCsv,
    importFromCraigslist,
    createCollection
  };
}; 