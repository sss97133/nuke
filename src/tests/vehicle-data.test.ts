import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '../types/database';

type Vehicle = Database['public']['Tables']['vehicles']['Row'];
type VehicleInsert = Database['public']['Tables']['vehicles']['Insert'];
type VehicleUpdate = Database['public']['Tables']['vehicles']['Update'];

interface TestVehicle {
  make: string;
  model: string;
  year: number;
  vin: string;
  color?: string;
  mileage?: number;
  description?: string;
}

describe('Vehicle Data Management', () => {
  const testVehicle: TestVehicle = {
    make: 'Toyota',
    model: 'Camry',
    year: 2020,
    vin: `TEST${Date.now()}`,
    color: 'Silver',
    mileage: 50000,
    description: 'Test vehicle for data management'
  };

  let vehicleId: string;
  let userId: string;

  beforeAll(async () => {
    // Create test user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: `test-${Date.now()}@example.com`,
      password: 'testPassword123!'
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create test user');
    
    userId = authData.user.id;

    // Create vehicle
    const vehicleData: VehicleInsert = {
      user_id: userId,
      make: testVehicle.make,
      model: testVehicle.model,
      year: testVehicle.year,
      vin: testVehicle.vin,
      color: testVehicle.color,
      mileage: testVehicle.mileage,
      description: testVehicle.description,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: vehicleResult, error: vehicleError } = await supabase
      .from('vehicles')
      .insert([vehicleData])
      .select()
      .single();

    if (vehicleError) throw vehicleError;
    if (!vehicleResult) throw new Error('Failed to create test vehicle');
    
    vehicleId = vehicleResult.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (vehicleId) {
      const { error: vehicleError } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', vehicleId);

      if (vehicleError) console.error('Error cleaning up vehicle:', vehicleError);
    }

    if (userId) {
      const { error: userError } = await supabase.auth.admin.deleteUser(userId);
      if (userError) console.error('Error cleaning up user:', userError);
    }
  });

  it('should store vehicle data correctly', async () => {
    const { data, error } = await supabase
      .from('vehicles')
      .select()
      .eq('id', vehicleId)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    if (data) {
      expect(data.make).toBe(testVehicle.make);
      expect(data.model).toBe(testVehicle.model);
      expect(data.year).toBe(testVehicle.year);
      expect(data.vin).toBe(testVehicle.vin);
      expect(data.color).toBe(testVehicle.color);
      expect(data.mileage).toBe(testVehicle.mileage);
      expect(data.description).toBe(testVehicle.description);
    }
  });

  it('should update vehicle data', async () => {
    const updateData: VehicleUpdate = {
      color: 'Blue',
      mileage: 55000,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicleId);

    expect(updateError).toBeNull();

    // Verify the update
    const { data, error: fetchError } = await supabase
      .from('vehicles')
      .select()
      .eq('id', vehicleId)
      .single();

    expect(fetchError).toBeNull();
    if (data) {
      expect(data.color).toBe(updateData.color);
      expect(data.mileage).toBe(updateData.mileage);
    }
  });

  it('should store vehicle images', async () => {
    // Create a test image record
    const imageData = {
      vehicle_id: vehicleId,
      url: 'https://example.com/test-image.jpg',
      timestamp: new Date().toISOString(),
      image_type: 'exterior',
      angle: 'front',
      confidence: 1.0,
      labels: ['car', 'toyota', 'camry'],
      additional_details: { source: 'test' }
    };

    const { error: insertError } = await supabase
      .from('vehicle_images')
      .insert([imageData]);

    expect(insertError).toBeNull();

    // Verify image was stored
    const { data, error: fetchError } = await supabase
      .from('vehicle_images')
      .select()
      .eq('vehicle_id', vehicleId)
      .single();

    expect(fetchError).toBeNull();
    if (data) {
      expect(data.url).toBe(imageData.url);
      expect(data.image_type).toBe(imageData.image_type);
      expect(data.angle).toBe(imageData.angle);
      expect(data.labels).toEqual(imageData.labels);
    }
  });

  it('should track vehicle service records', async () => {
    const serviceData = {
      vehicle_id: vehicleId,
      service_date: new Date().toISOString(),
      mileage: 55000,
      service_type: 'Oil Change',
      description: 'Regular maintenance',
      cost: 50.00,
      provider: 'Test Garage',
      data_source: 'manual',
      confidence: 1.0,
      additional_details: { notes: 'Test service record' }
    };

    const { error: insertError } = await supabase
      .from('service_records')
      .insert([serviceData]);

    expect(insertError).toBeNull();

    // Verify service record was stored
    const { data, error: fetchError } = await supabase
      .from('service_records')
      .select()
      .eq('vehicle_id', vehicleId)
      .single();

    expect(fetchError).toBeNull();
    if (data) {
      expect(data.service_type).toBe(serviceData.service_type);
      expect(data.mileage).toBe(serviceData.mileage);
      expect(data.cost).toBe(serviceData.cost);
      expect(data.provider).toBe(serviceData.provider);
    }
  });
}); 