import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import VehicleZoningLayout from '@/zones/VehicleZoningLayout';
import { LoadingScreen } from '@/components/common/LoadingScreen';
import { useToast } from '@/components/ui/toast';
import { useAuthState } from '@/hooks/auth/use-auth-state';

/**
 * VehicleZoningPage
 * 
 * Displays a vehicle using the new zone-based architecture.
 * - Uses real vehicle data from Supabase (no mock data)
 * - Follows the vehicle-centric architecture principles
 * - Implements the multi-source connector framework
 */
const VehicleZoningPage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [loading, setLoading] = useState(true);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [userProfile, setUserProfile] = useState<{ name: string; avatarUrl?: string }>({
    name: 'Guest User'
  });
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session } = useAuthState();
  
  useEffect(() => {
    // If no vehicleId provided, fetch the first available vehicle from the database
    const fetchVehicleData = async () => {
      try {
        setLoading(true);
        
        let targetVehicleId = vehicleId;
        
        // Check for authentication
        if (!session) {
          console.log('No authentication session. Redirecting to login page.');
          toast({
            title: "Authentication Required",
            description: "Please log in to view vehicle data.",
            variant: "destructive"
          });
          
          // Redirect to login page with a return URL
          navigate(`/login?returnUrl=${encodeURIComponent(window.location.pathname)}`);
          setLoading(false);
          return;
        }
        
        // Always use real vehicle data from Supabase
        
        // If no vehicleId was provided in the URL, get the first available vehicle
        if (!targetVehicleId) {
          const { data: vehiclesData, error: vehiclesError } = await supabase
            .from('vehicles')
            .select('id')
            .limit(1)
            .single();
            
          if (vehiclesError) throw vehiclesError;
          if (!vehiclesData) {
            toast({
              title: "No vehicles found",
              description: "Please add a vehicle to your database first.",
              variant: "destructive"
            });
            navigate('/vehicles/add');
            return;
          }
          
          targetVehicleId = vehiclesData.id as string;
          // Update URL to include the vehicle ID without reloading the page
          navigate(`/vehicles/zoning/${targetVehicleId}`, { replace: true });
        }
        
        // Fetch the vehicle data
        const { data: vehicleData, error: vehicleError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', targetVehicleId)
          .single();
          
        if (vehicleError) throw vehicleError;
        setVehicle(vehicleData);
        
        // Get current user profile
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', user.id)
            .single();
            
          if (!profileError && profileData) {
            setUserProfile({
              name: (profileData as ProfileData).full_name || user.email?.split('@')[0] || 'User',
              avatarUrl: (profileData as ProfileData).avatar_url
            });
          }
        }
      } catch (error) {
        console.error('Error fetching vehicle data:', error);
        toast({
          title: "Error loading vehicle",
          description: "Failed to load vehicle data. Please try again.",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchVehicleData();
  }, [vehicleId, navigate]);
  
  if (loading) {
    return <LoadingScreen message="Loading vehicle data..." />;
  }
  
  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <h1 className="text-2xl font-bold mb-4">Vehicle Not Found</h1>
        <p className="mb-4">The requested vehicle could not be found.</p>
        <button 
          className="bg-blue-500 text-white px-4 py-2 rounded"
          onClick={() => navigate('/vehicles')}
        >
          Back to Vehicles
        </button>
      </div>
    );
  }
  
  return (
    <VehicleZoningLayout 
      vehicleId={vehicle.id}
      activeRoute={`/vehicles/zoning/${vehicle.id}`}
      userProfile={userProfile}
    />
  );
};

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  status: string;
  metadata: Record<string, unknown>;
}

interface ProfileData {
  full_name: string;
  avatar_url: string;
  email: string;
  id: string;
}

export default VehicleZoningPage;
