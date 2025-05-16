import { supabase } from '../supabase';
import { validateImageFile } from '../validation/image-validation';

interface TestVehicle {
  id?: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  user_id: string;
  images?: string[];
}

export const testVehicleUpload = async (userId: string): Promise<void> => {
  try {
    // Test vehicle data
    const testVehicle: TestVehicle = {
      make: "Toyota",
      model: "Camry",
      year: 2020,
      vin: "1HGCM82633A123456",
      user_id: userId
    };
    
    console.log('Starting vehicle upload test...');
    
    // Test database upload
    const { data: uploadedVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert([testVehicle])
      .select()
      .single();
    
    if (vehicleError) {
      console.error('Vehicle upload failed:', vehicleError);
      return;
    }
    
    console.log('Vehicle upload successful:', uploadedVehicle);
    
    // Test image upload
    const testImage = new File(
      ['test-image-data'], 
      'test-image.jpg', 
      { type: 'image/jpeg' }
    );
    
    // Validate image first
    const validationResult = await validateImageFile(testImage);
    if (!validationResult.valid) {
      console.error('Image validation failed:', validationResult.error);
      return;
    }
    
    // Upload image
    const imagePath = `vehicles/${Date.now()}-${testImage.name}`;
    const { data: imageData, error: imageError } = await supabase.storage
      .from('vehicle-images')
      .upload(imagePath, testImage);
    
    if (imageError) {
      console.error('Image upload failed:', imageError);
      return;
    }
    
    console.log('Image upload successful:', imageData);
    
    // Update vehicle with image path
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({ images: [imagePath] })
      .eq('id', uploadedVehicle.id);
    
    if (updateError) {
      console.error('Failed to update vehicle with image:', updateError);
      return;
    }
    
    console.log('Test completed successfully!');
    
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}; 