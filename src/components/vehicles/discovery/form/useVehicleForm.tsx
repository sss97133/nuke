
import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { Vehicle } from '../types';

interface UseVehicleFormProps {
  onAddVehicle: (vehicle: Omit<Vehicle, 'id' | 'added' | 'relevance_score'>) => Promise<any>;
  onCancel: () => void;
}

export const useVehicleForm = ({ onAddVehicle, onCancel }: UseVehicleFormProps) => {
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

  const isFormValid = !!(formData.make && formData.model && formData.year);

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

  return {
    formData,
    isSubmitting,
    isFormValid,
    handleChange,
    handleSubmit
  };
};
