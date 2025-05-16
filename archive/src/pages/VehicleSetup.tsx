import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const VehicleSetup: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<boolean>(false);
  const [user, setUser] = useState<any>(null);
  const [vehicleCount, setVehicleCount] = useState<number>(0);
  const [formData, setFormData] = useState({
    make: '',
    model: '',
    year: new Date().getFullYear(),
    vin: '',
    notes: ''
  });

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        // Call the database function to initialize user onboarding
        const { data: onboardingData, error: onboardingError } = await supabase
          .rpc('initialize_user_onboarding', { user_uuid: user.id });
          
        if (onboardingError) {
          console.error('Error initializing onboarding:', onboardingError);
        } else {
          console.log('Onboarding initialized:', onboardingData);
        }
        
        // Check if user has vehicles
        const { data: vehiclesData, error: vehiclesError } = await supabase
          .rpc('has_vehicles', { user_uuid: user.id });
          
        if (!vehiclesError && vehiclesData) {
          const { data: userVehicles } = await supabase
            .from('vehicles')
            .select('*')
            .eq('user_id', user.id);
            
          setVehicleCount(userVehicles?.length || 0);
        }
      }
    };
    
    checkAuth();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'year' ? parseInt(value) || new Date().getFullYear() : value
    }));
  };

  const addTestVehicle = async () => {
    if (!user) {
      toast({
        title: 'Authentication Required',
        description: 'Please sign in to add a vehicle.',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('add_test_vehicle', {
        user_uuid: user.id,
        vehicle_make: 'Test Vehicle',
        vehicle_model: 'Demo Model',
        vehicle_year: 2025
      });

      if (error) throw error;

      toast({
        title: 'Success!',
        description: 'Test vehicle added successfully',
      });
      
      setVehicleCount(prev => prev + 1);
      
      // Refresh vehicle list
      const { data: userVehicles } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', user.id);
        
      setVehicleCount(userVehicles?.length || 0);
      
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add test vehicle',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast({
        title: 'Authentication Required',
        description: 'Please sign in to add a vehicle.',
        variant: 'destructive'
      });
      return;
    }

    if (!formData.make || !formData.model || !formData.year) {
      toast({
        title: 'Validation Error',
        description: 'Make, model, and year are required.',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      // Insert the vehicle directly
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          user_id: user.id,
          make: formData.make,
          model: formData.model,
          year: formData.year,
          vin: formData.vin || null,
          notes: formData.notes || null
        })
        .select();

      if (error) throw error;

      toast({
        title: 'Success!',
        description: 'Vehicle added successfully',
      });
      
      setFormData({
        make: '',
        model: '',
        year: new Date().getFullYear(),
        vin: '',
        notes: ''
      });
      
      setVehicleCount(prev => prev + 1);
      
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add vehicle',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const viewVehicles = () => {
    navigate('/vehicles');
  };

  const goToDashboard = () => {
    navigate('/dashboard');
  };

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-2xl">Vehicle Setup</CardTitle>
          <CardDescription>
            Add your first vehicle to get started with the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <h3 className="font-semibold mb-2">Your Vehicle Status</h3>
            <p>{vehicleCount === 0 
              ? "You don't have any vehicles yet. Add one below to get started." 
              : `You have ${vehicleCount} vehicle${vehicleCount !== 1 ? 's' : ''} in the system.`}
            </p>
            {vehicleCount > 0 && (
              <Button 
                variant="outline" 
                onClick={viewVehicles} 
                className="mt-2"
              >
                View My Vehicles
              </Button>
            )}
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="make">Make</Label>
                <Input
                  id="make"
                  name="make"
                  placeholder="e.g. Toyota"
                  value={formData.make}
                  onChange={handleInputChange}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  name="model"
                  placeholder="e.g. Camry"
                  value={formData.model}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  name="year"
                  type="number"
                  placeholder="Year"
                  value={formData.year}
                  onChange={handleInputChange}
                  min={1900}
                  max={new Date().getFullYear() + 1}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="vin">VIN (Optional)</Label>
                <Input
                  id="vin"
                  name="vin"
                  placeholder="Vehicle Identification Number"
                  value={formData.vin}
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input
                id="notes"
                name="notes"
                placeholder="Any additional information about your vehicle"
                value={formData.notes}
                onChange={handleInputChange}
              />
            </div>
            
            <div className="flex flex-col sm:flex-row gap-2 pt-4">
              <Button type="submit" disabled={loading}>
                {loading ? 'Adding Vehicle...' : 'Add Vehicle'}
              </Button>
              
              <Button 
                type="button" 
                variant="outline" 
                onClick={addTestVehicle} 
                disabled={loading}
              >
                Add Test Vehicle
              </Button>
            </div>
          </form>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button onClick={goToDashboard}>
            Go to Dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default VehicleSetup;
