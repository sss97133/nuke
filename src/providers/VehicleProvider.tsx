import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase-client';
import { toast } from '@/components/ui/use-toast';
import { Vehicle, VerificationLevel, VehicleOperationResult } from '@/types/vehicle';

// Unified Vehicle context type that combines authentication and vehicle identity
interface VehicleContextType {
  // Auth-related
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  signInAnonymously: () => Promise<{ error: any }>;
  convertAnonymous: (email: string, password: string) => Promise<{ error: any }>;
  isAnonymous: boolean;
  
  // Vehicle-related
  vehicles: Vehicle[];
  hasVehicles: boolean;
  currentVehicle: Vehicle | null;
  setCurrentVehicle: (vehicle: Vehicle) => void;
  ensureVehicleExists: () => Promise<string | null>;
  addVehicle: (vehicleData: Partial<Vehicle>) => Promise<Vehicle | null>;
  updateVehicle: (id: string, vehicleData: Partial<Vehicle>) => Promise<boolean>;
  deleteVehicle: (id: string) => Promise<boolean>;
  
  // Vehicle identity-related
  verificationLevel: VerificationLevel;
  verifiedVehicleCount: number;
  trustScore: number;
  isVerifyingIdentity: boolean;
  verifyVehicleIdentity: (vehicleId: string) => Promise<boolean>;
  getVehicleTrustScore: (vehicleId: string) => Promise<number>;
}

// Create context with default values
const VehicleContext = createContext<VehicleContextType>({
  // Auth defaults
  session: null,
  user: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  signInAnonymously: async () => ({ error: null }),
  convertAnonymous: async () => ({ error: null }),
  isAnonymous: false,
  
  // Vehicle defaults
  vehicles: [],
  hasVehicles: false,
  currentVehicle: null,
  setCurrentVehicle: () => {},
  ensureVehicleExists: async () => null,
  addVehicle: async () => null,
  updateVehicle: async () => false,
  deleteVehicle: async () => false,
  
  // Vehicle identity defaults
  verificationLevel: 'unverified',
  verifiedVehicleCount: 0,
  trustScore: 0,
  isVerifyingIdentity: false,
  verifyVehicleIdentity: async () => false,
  getVehicleTrustScore: async () => 0
});

// Hook for using the context
export const useVehicle = () => useContext(VehicleContext);

// Provider component
export const VehicleProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Auth state
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  
  // Vehicle state
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [currentVehicle, setCurrentVehicle] = useState<Vehicle | null>(null);
  
  // Vehicle identity state
  const [isVerifyingIdentity, setIsVerifyingIdentity] = useState(false);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>('unverified');
  const [verifiedVehicleCount, setVerifiedVehicleCount] = useState(0);
  const [trustScore, setTrustScore] = useState(0);
  
  const navigate = useNavigate();

  // Initialize user and session
  useEffect(() => {
    const initUser = async () => {
      setLoading(true);
      try {
        // Get session
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        
        if (session?.user) {
          setUser(session.user);
          
          // Check if user is anonymous
          setIsAnonymous(
            session.user.app_metadata?.provider === 'anonymous' || 
            !!session.user.email?.includes('anon')
          );
          
          // Load user vehicles
          await loadUserVehicles(session.user.id);
        } else {
          // Reset state when not authenticated
          resetState();
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
        
        if (session?.user) {
          setUser(session.user);
          
          // Check if user is anonymous
          setIsAnonymous(
            session.user.app_metadata?.provider === 'anonymous' || 
            !!session.user.email?.includes('anon')
          );
          
          // Load user vehicles on sign in or token refresh
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            await loadUserVehicles(session.user.id);
          }
        } else {
          // Reset state on sign out
          resetState();
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Reset all state when user logs out
  const resetState = () => {
    setUser(null);
    setVehicles([]);
    setCurrentVehicle(null);
    setVerificationLevel('unverified');
    setVerifiedVehicleCount(0);
    setTrustScore(0);
    setIsAnonymous(false);
  };

  // Load user vehicles and calculate stats
  const loadUserVehicles = async (userId: string) => {
    try {
      // Get all vehicles for the user
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      // Store vehicles
      const vehicleData = data || [];
      setVehicles(vehicleData);
      
      // Set current vehicle to first one if we have vehicles and none is selected
      if (vehicleData.length > 0 && !currentVehicle) {
        setCurrentVehicle(vehicleData[0]);
      }
      
      if (vehicleData.length > 0) {
        // Count verified vehicles
        const verified = vehicleData.filter(v => v.verification_level !== 'unverified');
        setVerifiedVehicleCount(verified.length);

        // Determine highest verification level
        if (verified.some(v => v.verification_level === 'blockchain')) {
          setVerificationLevel('blockchain');
        } else if (verified.some(v => v.verification_level === 'ptz')) {
          setVerificationLevel('ptz');
        } else if (verified.some(v => v.verification_level === 'professional')) {
          setVerificationLevel('professional');
        } else if (verified.length > 0) {
          setVerificationLevel('basic');
        } else {
          setVerificationLevel('unverified');
        }

        // Calculate average trust score
        const avgScore = vehicleData.reduce((sum, v) => sum + (v.trust_score || 0), 0) / vehicleData.length;
        setTrustScore(Math.round(avgScore));
      } else if (userId) {
        // No vehicles found - first login should enforce vehicle creation
        setVerificationLevel('unverified');
        setTrustScore(0);
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

  // Authentication methods
  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      return { error };
    } catch (error) {
      console.error('Sign in error:', error);
      return { error };
    }
  };

  // Anonymous authentication - allows using app before creating account
  const signInAnonymously = async () => {
    try {
      // Using a temporary unique email to support anonymous auth
      const randomId = Math.random().toString(36).substring(2);
      const tempEmail = `anon-${randomId}@temporary.com`;
      const tempPassword = randomId + 'Temp!123';
      
      const { error } = await supabase.auth.signUp({
        email: tempEmail,
        password: tempPassword,
        options: {
          data: {
            provider: 'anonymous'
          }
        }
      });
      
      return { error };
    } catch (error) {
      console.error('Anonymous sign in error:', error);
      return { error };
    }
  };

  // Convert anonymous account to real account
  const convertAnonymous = async (email: string, password: string) => {
    if (!user) return { error: new Error('Not authenticated') };
    
    try {
      // Update email and password for the current user
      const { error } = await supabase.auth.updateUser({
        email,
        password,
        data: {
          provider: 'email'
        }
      });
      
      if (!error) {
        setIsAnonymous(false);
      }
      
      return { error };
    } catch (error) {
      console.error('Error converting anonymous account:', error);
      return { error };
    }
  };

  // Sign out
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
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

  // Add new vehicle
  const addVehicle = async (vehicleData: Partial<Vehicle>): Promise<Vehicle | null> => {
    if (!user) return null;
    
    try {
      const newVehicle = {
        ...vehicleData,
        user_id: user.id,
        trust_score: 0,
        verification_level: 'unverified' as VerificationLevel
      };
      
      const { data, error } = await supabase
        .from('vehicles')
        .insert([newVehicle])
        .select()
        .single();
        
      if (error) throw error;
      
      // Reload vehicles
      await loadUserVehicles(user.id);
      
      return data;
    } catch (error) {
      console.error('Error adding vehicle:', error);
      toast({
        title: 'Error adding vehicle',
        description: 'There was a problem adding your vehicle.',
        variant: 'destructive'
      });
      return null;
    }
  };

  // Update vehicle
  const updateVehicle = async (id: string, vehicleData: Partial<Vehicle>): Promise<boolean> => {
    if (!user) return false;
    
    try {
      const { error } = await supabase
        .from('vehicles')
        .update(vehicleData)
        .eq('id', id)
        .eq('user_id', user.id); // Security check
        
      if (error) throw error;
      
      // Reload vehicles
      await loadUserVehicles(user.id);
      
      return true;
    } catch (error) {
      console.error('Error updating vehicle:', error);
      toast({
        title: 'Error updating vehicle',
        description: 'There was a problem updating your vehicle.',
        variant: 'destructive'
      });
      return false;
    }
  };

  // Delete vehicle
  const deleteVehicle = async (id: string): Promise<boolean> => {
    if (!user) return false;
    
    try {
      const { error } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id); // Security check
        
      if (error) throw error;
      
      // Reload vehicles
      await loadUserVehicles(user.id);
      
      return true;
    } catch (error) {
      console.error('Error deleting vehicle:', error);
      toast({
        title: 'Error deleting vehicle',
        description: 'There was a problem deleting your vehicle.',
        variant: 'destructive'
      });
      return false;
    }
  };

  // Verify vehicle identity
  const verifyVehicleIdentity = async (vehicleId: string): Promise<boolean> => {
    if (!user || !session) return false;

    try {
      setIsVerifyingIdentity(true);

      // Get the vehicle details
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (error) throw error;

      // Check if user has rights to verify
      if (vehicle.user_id !== user.id) {
        throw new Error('Unauthorized: You can only verify vehicles you own');
      }

      // Process verification
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ 
          verification_level: 'basic',
          verified_at: new Date().toISOString(),
          trust_score: Math.min((vehicle.trust_score || 0) + 10, 100)
        })
        .eq('id', vehicleId);

      if (updateError) throw updateError;

      // Create timeline entry for verification
      await supabase
        .from('vehicle_timeline')
        .insert({
          vehicle_id: vehicleId,
          event_type: 'verification',
          event_date: new Date().toISOString(),
          data: {
            level: 'basic',
            verified_by: 'owner',
            method: 'digital'
          }
        });

      // Reload vehicle data
      await loadUserVehicles(user.id);
      return true;
    } catch (error) {
      console.error('Error verifying vehicle identity:', error);
      return false;
    } finally {
      setIsVerifyingIdentity(false);
    }
  };

  // Get trust score for a specific vehicle
  const getVehicleTrustScore = async (vehicleId: string): Promise<number> => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('trust_score')
        .eq('id', vehicleId)
        .single();

      if (error) throw error;
      return data.trust_score || 0;
    } catch (error) {
      console.error('Error getting vehicle trust score:', error);
      return 0;
    }
  };

  // Context value
  const value: VehicleContextType = {
    // Auth state
    session,
    user,
    loading,
    signIn,
    signOut,
    signInAnonymously,
    convertAnonymous,
    isAnonymous,
    
    // Vehicle state
    vehicles,
    hasVehicles: vehicles.length > 0,
    currentVehicle,
    setCurrentVehicle,
    ensureVehicleExists,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    
    // Vehicle identity state
    verificationLevel,
    verifiedVehicleCount,
    trustScore,
    isVerifyingIdentity,
    verifyVehicleIdentity,
    getVehicleTrustScore
  };

  return (
    <VehicleContext.Provider value={value}>
      {children}
    </VehicleContext.Provider>
  );
};

// Component that ensures a vehicle exists before rendering children
export const VehicleRequired: React.FC<{
  children: React.ReactNode;
  redirectTo?: string;
}> = ({ children, redirectTo = '/vehicle-setup' }) => {
  const { loading, hasVehicles, ensureVehicleExists } = useVehicle();
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

export default VehicleProvider;
