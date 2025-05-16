import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase-client';
import { toast } from '@/components/ui/use-toast';

// Define the vehicle interface based on your schema
interface Vehicle {
  id: string;
  user_id: string;
  make: string;
  model: string;
  year: number;
  trust_score?: number;
  verification_level?: number;
  created_at?: string;
  updated_at?: string;
}

// Context interface
interface VehicleAuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  vehicles: Vehicle[];
  hasVehicles: boolean;
  currentVehicle: Vehicle | null;
  setCurrentVehicle: (vehicle: Vehicle) => void;
  signOut: () => Promise<void>;
  ensureVehicleExists: () => Promise<string | null>;
}

// Create context with default values
const VehicleAuthContext = createContext<VehicleAuthContextType>({
  session: null,
  user: null,
  loading: true,
  vehicles: [],
  hasVehicles: false,
  currentVehicle: null,
  setCurrentVehicle: () => {},
  signOut: async () => {},
  ensureVehicleExists: async () => null
});

// Hook for using the context
export const useVehicleAuth = () => useContext(VehicleAuthContext);

// Provider component
export const VehicleAuthProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [currentVehicle, setCurrentVehicle] = useState<Vehicle | null>(null);
  const navigate = useNavigate();

  // Load user and vehicles
  useEffect(() => {
    // Get initial session
    const initUser = async () => {
      setLoading(true);
      try {
        // Get session
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          // Fetch user's vehicles
          await loadUserVehicles(session.user.id);
        } else {
          setVehicles([]);
          setCurrentVehicle(null);
        }
      } catch (error) {
        console.error('Error initializing user:', error);
      } finally {
        setLoading(false);
      }
    };

    initUser();

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await loadUserVehicles(session.user.id);
        } else {
          setVehicles([]);
          setCurrentVehicle(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Load user vehicles
  const loadUserVehicles = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      setVehicles(data || []);
      
      // Set current vehicle to first one if we have vehicles and none is selected
      if (data && data.length > 0 && !currentVehicle) {
        setCurrentVehicle(data[0]);
      }
    } catch (error) {
      console.error('Error loading vehicles:', error);
      toast({
        title: 'Error loading vehicles',
        description: 'There was a problem loading your vehicles.',
        variant: 'destructive'
      });
    }
  };

  // Ensure user has at least one vehicle
  const ensureVehicleExists = async (): Promise<string | null> => {
    if (!user) return null;
    
    if (vehicles.length > 0) {
      return vehicles[0].id;
    }
    
    try {
      // Call the database function to ensure a vehicle exists
      const { data, error } = await supabase
        .rpc('ensure_user_has_vehicle', { user_uuid: user.id });
        
      if (error) throw error;
      
      // Reload vehicles after ensuring one exists
      await loadUserVehicles(user.id);
      
      return data as string;
    } catch (error) {
      console.error('Error ensuring vehicle exists:', error);
      toast({
        title: 'Error creating vehicle',
        description: 'There was a problem creating your vehicle profile.',
        variant: 'destructive'
      });
      return null;
    }
  };

  // Sign out
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  // Context value
  const value = {
    session,
    user,
    loading,
    vehicles,
    hasVehicles: vehicles.length > 0,
    currentVehicle,
    setCurrentVehicle,
    signOut,
    ensureVehicleExists
  };

  return (
    <VehicleAuthContext.Provider value={value}>
      {children}
    </VehicleAuthContext.Provider>
  );
};

// Component that ensures a vehicle exists before rendering children
export const VehicleRequired: React.FC<{
  children: React.ReactNode;
  redirectTo?: string;
}> = ({ children, redirectTo = '/vehicle-setup' }) => {
  const { loading, hasVehicles, ensureVehicleExists } = useVehicleAuth();
  const navigate = useNavigate();
  const [checkingVehicle, setCheckingVehicle] = useState(true);
  
  useEffect(() => {
    const checkVehicle = async () => {
      if (!loading && !hasVehicles) {
        // Try to create a vehicle automatically first
        const vehicleId = await ensureVehicleExists();
        
        if (!vehicleId) {
          // If still no vehicle, redirect
          navigate(redirectTo);
        }
      }
      setCheckingVehicle(false);
    };
    
    checkVehicle();
  }, [loading, hasVehicles, redirectTo, navigate, ensureVehicleExists]);
  
  if (loading || checkingVehicle) {
    return <div className="flex justify-center items-center h-screen">Loading vehicle data...</div>;
  }
  
  return <>{children}</>;
};
