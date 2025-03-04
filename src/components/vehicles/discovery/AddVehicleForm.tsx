
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { Vehicle } from './types';

interface AddVehicleFormProps {
  onAddVehicle: (vehicle: Omit<Vehicle, 'id' | 'added' | 'relevance_score'>) => Promise<any>;
  onCancel: () => void;
}

const AddVehicleForm = ({ onAddVehicle, onCancel }: AddVehicleFormProps) => {
  const [formData, setFormData] = useState({
    make: '',
    model: '',
    year: new Date().getFullYear(),
    price: 0,
    mileage: 0,
    image: '/placeholder.svg',
    location: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    let parsedValue: any = value;
    
    if (name === 'year' || name === 'mileage' || name === 'price') {
      parsedValue = Number(value);
    }
    
    setFormData(prev => ({ ...prev, [name]: parsedValue }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // Adding minimal fields for vehicle that match the database schema
      const vehicleData = {
        ...formData,
        // These fields don't exist in the database but are required by our Vehicle type
        // We'll add default values that will be stripped before sending to the database
        market_value: 0,
        price_trend: 'stable' as 'up' | 'down' | 'stable',
        tags: [],
        condition_rating: 5,
        vehicle_type: 'car',
        body_type: '',
        transmission: '',
        drivetrain: '',
        rarity_score: 0
      };

      await onAddVehicle(vehicleData);
      toast({
        title: 'Vehicle Added',
        description: 'The vehicle has been successfully added.',
      });
      // Reset form
      setFormData({
        make: '',
        model: '',
        year: new Date().getFullYear(),
        price: 0,
        mileage: 0,
        image: '/placeholder.svg',
        location: ''
      });
      onCancel(); // Close the form after successful submission
    } catch (error) {
      console.error('Error adding vehicle:', error);
      toast({
        title: 'Error',
        description: 'Failed to add vehicle. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Add New Vehicle</CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="make">Make *</Label>
              <Input 
                id="make" 
                name="make" 
                value={formData.make} 
                onChange={handleChange} 
                required 
                placeholder="e.g. Toyota"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model *</Label>
              <Input 
                id="model" 
                name="model" 
                value={formData.model} 
                onChange={handleChange} 
                required 
                placeholder="e.g. Supra"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="year">Year *</Label>
              <Input 
                id="year" 
                name="year" 
                type="number" 
                value={formData.year} 
                onChange={handleChange} 
                required 
                min={1900} 
                max={new Date().getFullYear() + 1}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price ($)</Label>
              <Input 
                id="price" 
                name="price" 
                type="number" 
                value={formData.price} 
                onChange={handleChange} 
                min={0}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mileage">Mileage</Label>
              <Input 
                id="mileage" 
                name="mileage" 
                type="number" 
                value={formData.mileage} 
                onChange={handleChange} 
                min={0}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input 
                id="location" 
                name="location" 
                value={formData.location} 
                onChange={handleChange} 
                placeholder="e.g. Los Angeles, CA"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="image">Image URL</Label>
              <Input 
                id="image" 
                name="image" 
                value={formData.image} 
                onChange={handleChange} 
                placeholder="https://example.com/image.jpg"
              />
            </div>
          </div>
        </CardContent>
        
        <CardFooter className="flex justify-end gap-2">
          <Button 
            type="button" 
            variant="outline" 
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            disabled={isSubmitting || !formData.make || !formData.model || !formData.year}
          >
            {isSubmitting ? 'Adding...' : 'Add Vehicle'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

export default AddVehicleForm;
