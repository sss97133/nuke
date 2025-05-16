import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

// Debug page focused on the vehicle-centric approach
const DebugFixed: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<boolean>(false);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [vehicleData, setVehicleData] = useState({
    make: '',
    model: '',
    year: new Date().getFullYear()
  });

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        // Get profile data
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
          
        setProfile(profileData);
        
        // Get vehicle data
        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', user.id);
          
        setVehicles(vehicleData || []);
      }
    };
    
    checkAuth();
  }, []);

  const fixProfile = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Call the database function to fix user navigation
      const { data, error } = await supabase
        .rpc('fix_user_navigation', { user_uuid: user.id });
        
      if (error) throw error;

      toast({
        title: 'Profile Fixed',
        description: 'Your profile has been repaired.',
      });
      
      // Refresh profile data
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
        
      setProfile(updatedProfile);
      
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };
  
  const clearAuth = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    toast({
      title: 'Signed Out',
      description: 'Authentication data cleared.'
    });
    navigate('/login');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setVehicleData(prev => ({
      ...prev,
      [name]: name === 'year' ? parseInt(value) || new Date().getFullYear() : value
    }));
  };

  const addVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          user_id: user.id,
          make: vehicleData.make,
          model: vehicleData.model,
          year: vehicleData.year,
          trust_score: 50, // Default trust score
          verification_level: 1 // Default verification level
        })
        .select();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Vehicle added successfully',
      });

      // Refresh vehicle data
      const { data: updatedVehicles } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', user.id);

      setVehicles(updatedVehicles || []);
      
      // Clear form
      setVehicleData({
        make: '',
        model: '',
        year: new Date().getFullYear()
      });
      
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const forceNavigate = (path: string) => {
    navigate(path);
  };

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-2xl">Vehicle-Centric Diagnostics</CardTitle>
          <CardDescription>
            Bypass loading issues and establish your vehicle identity
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Auth Status */}
          <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <h3 className="font-semibold mb-2">Auth Status</h3>
            <p>{user ? `Signed in as ${user.email}` : 'Not signed in'}</p>
            {!user && (
              <Button className="mt-2" onClick={() => navigate('/login')}>
                Sign In
              </Button>
            )}
          </div>
          
          {/* Profile Status */}
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <h3 className="font-semibold mb-2">Profile Status</h3>
            {profile ? (
              <div>
                <p>Profile exists</p>
                <p>Onboarding completed: {profile.onboarding_completed ? 'Yes' : 'No'}</p>
                <p>Onboarding step: {profile.onboarding_step || 0}</p>
              </div>
            ) : (
              <p>No profile found</p>
            )}
            
            {user && !profile && (
              <Button className="mt-2" onClick={fixProfile} disabled={loading}>
                Create Profile
              </Button>
            )}
          </div>
          
          {/* Vehicle Status */}
          <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <h3 className="font-semibold mb-2">Vehicle Status</h3>
            {vehicles.length > 0 ? (
              <div>
                <p>You have {vehicles.length} vehicle(s):</p>
                <ul className="mt-2 list-disc pl-5">
                  {vehicles.map((vehicle) => (
                    <li key={vehicle.id}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>No vehicles found. {user && <span>Add one below to bypass loading issues.</span>}</p>
            )}
            {user && vehicles.length === 0 && (
              <div className="mt-2">
                <p><span className="font-medium">User ID:</span> {user.id}</p>
              </div>
            )}
          </div>
          
          {/* Add Vehicle Form */}
          {user && (
            <form onSubmit={addVehicle} className="mb-6 p-4 border rounded-lg">
              <h3 className="font-semibold mb-3">Add Vehicle</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="space-y-2">
                  <Label htmlFor="make">Make</Label>
                  <Input
                    id="make"
                    name="make"
                    placeholder="e.g. Toyota"
                    value={vehicleData.make}
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
                    value={vehicleData.model}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="year">Year</Label>
                  <Input
                    id="year"
                    name="year"
                    type="number"
                    placeholder="Year"
                    value={vehicleData.year}
                    onChange={handleInputChange}
                    min={1900}
                    max={new Date().getFullYear() + 1}
                    required
                  />
                </div>
              </div>
              
              <Button type="submit" disabled={loading}>
                {loading ? 'Adding...' : 'Add Vehicle'}
              </Button>
            </form>
          )}
          
          {/* Navigation Shortcuts */}
          <div className="mt-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <h3 className="font-semibold mb-3">Direct Navigation</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => forceNavigate('/vehicle-setup')}>
                Vehicle Setup
              </Button>
              <Button variant="outline" onClick={() => forceNavigate('/dashboard')}>
                Dashboard
              </Button>
              <Button variant="outline" onClick={() => forceNavigate('/onboarding')}>
                Onboarding
              </Button>
              <Button variant="outline" onClick={() => forceNavigate('/login')}>
                Login
              </Button>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex flex-col gap-2 mt-4">
            {user && (
              <Button 
                onClick={fixProfile} 
                disabled={loading}
                variant="outline"
              >
                {loading ? 'Fixing...' : 'Fix Navigation'}
              </Button>
            )}
            
            {user && (
              <Button 
                variant="destructive"
                onClick={clearAuth}
              >
                Clear Authentication
              </Button>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="secondary" onClick={() => navigate('/login')}>
            Back to Login
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default DebugFixed;
