
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
    market_value: 0,
    price_trend: 'stable' as 'up' | 'down' | 'stable',
    mileage: 0,
    image: '/placeholder.svg',
    location: '',
    tags: [] as string[],
    condition_rating: 5,
    vehicle_type: 'car',
    body_type: '',
    transmission: '',
    drivetrain: '',
    rarity_score: 0
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tag, setTag] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    let parsedValue: any = value;
    
    if (name === 'year' || name === 'mileage' || name === 'price' || name === 'market_value' || name === 'rarity_score' || name === 'condition_rating') {
      parsedValue = Number(value);
    }
    
    setFormData(prev => ({ ...prev, [name]: parsedValue }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const addTag = () => {
    if (tag && !formData.tags.includes(tag)) {
      setFormData(prev => ({ ...prev, tags: [...prev.tags, tag] }));
      setTag('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tagToRemove)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      await onAddVehicle(formData);
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
        market_value: 0,
        price_trend: 'stable',
        mileage: 0,
        image: '/placeholder.svg',
        location: '',
        tags: [],
        condition_rating: 5,
        vehicle_type: 'car',
        body_type: '',
        transmission: '',
        drivetrain: '',
        rarity_score: 0
      });
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
              <Label htmlFor="market_value">Market Value ($)</Label>
              <Input 
                id="market_value" 
                name="market_value" 
                type="number" 
                value={formData.market_value} 
                onChange={handleChange} 
                min={0}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price_trend">Price Trend</Label>
              <Select 
                value={formData.price_trend} 
                onValueChange={(value) => handleSelectChange('price_trend', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select trend" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="up">Up</SelectItem>
                  <SelectItem value="down">Down</SelectItem>
                  <SelectItem value="stable">Stable</SelectItem>
                </SelectContent>
              </Select>
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
            <div className="space-y-2">
              <Label htmlFor="condition_rating">Condition (1-10)</Label>
              <Input 
                id="condition_rating" 
                name="condition_rating" 
                type="number" 
                value={formData.condition_rating} 
                onChange={handleChange} 
                min={1} 
                max={10}
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle_type">Vehicle Type</Label>
              <Select 
                value={formData.vehicle_type} 
                onValueChange={(value) => handleSelectChange('vehicle_type', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="car">Car</SelectItem>
                  <SelectItem value="truck">Truck</SelectItem>
                  <SelectItem value="suv">SUV</SelectItem>
                  <SelectItem value="motorcycle">Motorcycle</SelectItem>
                  <SelectItem value="rv">RV</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="body_type">Body Type</Label>
              <Input 
                id="body_type" 
                name="body_type" 
                value={formData.body_type} 
                onChange={handleChange} 
                placeholder="e.g. Sedan, Coupe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transmission">Transmission</Label>
              <Select 
                value={formData.transmission} 
                onValueChange={(value) => handleSelectChange('transmission', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select transmission" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="cvt">CVT</SelectItem>
                  <SelectItem value="semi-automatic">Semi-automatic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="drivetrain">Drivetrain</Label>
              <Select 
                value={formData.drivetrain} 
                onValueChange={(value) => handleSelectChange('drivetrain', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select drivetrain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fwd">FWD</SelectItem>
                  <SelectItem value="rwd">RWD</SelectItem>
                  <SelectItem value="awd">AWD</SelectItem>
                  <SelectItem value="4wd">4WD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rarity_score">Rarity Score (1-10)</Label>
              <Input 
                id="rarity_score" 
                name="rarity_score" 
                type="number" 
                value={formData.rarity_score} 
                onChange={handleChange} 
                min={0} 
                max={10}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input 
                placeholder="Add a tag" 
                value={tag} 
                onChange={(e) => setTag(e.target.value)} 
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTag}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {formData.tags.map((tag, index) => (
                <span 
                  key={index}
                  className="bg-primary/10 text-primary px-2 py-1 rounded-md flex items-center gap-1"
                >
                  {tag}
                  <button
                    type="button"
                    className="text-primary hover:text-primary/70 focus:outline-none"
                    onClick={() => removeTag(tag)}
                  >
                    ×
                  </button>
                </span>
              ))}
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
