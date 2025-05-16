import type { Database } from '../types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ChevroletTruck {
  make: string;
  model: string;
  year: number;
  color: string;
  mileage: number;
  vin: string;
  ownership_status: string;
}

const chevroletTrucks: ChevroletTruck[] = [
  { make: 'Chevrolet', model: 'C10', year: 1973, color: 'Blue', mileage: 125000, vin: 'CCE143A123456', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'K10', year: 1975, color: 'Red', mileage: 156000, vin: 'CKE175J234567', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'C10', year: 1976, color: 'White', mileage: 89000, vin: 'CCE146S345678', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'K20', year: 1978, color: 'Black', mileage: 110500, vin: 'CKE208Y456789', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'C20', year: 1980, color: 'Green', mileage: 95000, vin: 'CCE208B567890', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'K30', year: 1983, color: 'Brown', mileage: 78500, vin: 'CKE338K678901', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'C30', year: 1985, color: 'Tan', mileage: 105000, vin: 'CCE358M789012', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'K10', year: 1987, color: 'Blue/White', mileage: 65000, vin: 'CKE178A890123', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'C20', year: 1989, color: 'Red/White', mileage: 83000, vin: 'CCE298T901234', ownership_status: 'owned' },
  { make: 'Chevrolet', model: 'K20', year: 1991, color: 'Silver', mileage: 72000, vin: 'CKE219Z012345', ownership_status: 'owned' }
];

async function importChevroletTrucks() {
  const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
  if (!user) {
    console.error('No user logged in');
    return;
  }

  console.log('Starting import of Chevrolet trucks...');

  for (const truck of chevroletTrucks) {
    try {
      const vehicleData = {
        ...truck,
        user_id: user.id,
        vehicle_type: 'truck',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'active',
        condition_rating: 7, // Default condition rating
        rarity_score: 6, // Default rarity score
        relevance_score: 8, // Default relevance score
        restoration_status: 'original',
        era: truck.year < 1980 ? 'classic' : 'vintage',
        transmission: 'manual', // Default transmission
        drivetrain: truck.model.startsWith('K') ? '4x4' : '2WD',
        engine_type: 'V8', // Default engine type
        body_type: 'pickup',
        notes: `Classic Chevrolet ${truck.model} truck from ${truck.year}`
      };

      const { data, error } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select();

      if (error) {
        console.error(`Error importing truck ${truck.year} ${truck.make} ${truck.model}:`, error);
      } else {
        console.log(`Successfully imported: ${truck.year} ${truck.make} ${truck.model}`);
      }
    } catch (error) {
      console.error(`Error processing truck ${truck.year} ${truck.make} ${truck.model}:`, error);
    }
  }

  console.log('Import completed');
}

// Run the import
importChevroletTrucks(); 