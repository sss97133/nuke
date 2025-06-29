import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';
// Direct import of Session type to avoid circular imports
import { Session } from '@supabase/supabase-js';

// Vehicle verification levels based on trust mechanisms
export type VerificationLevel = 'unverified' | 'basic' | 'professional' | 'ptz' | 'blockchain';

// Interface for vehicle identity context
interface VehicleIdentityContextType {
  isVerifyingIdentity: boolean;
  verificationLevel: VerificationLevel;
  verifiedVehicleCount: number;
  trustScore: number; // 0-100 score representing overall trust
  verifyVehicleIdentity: (vehicleId: string) => Promise<boolean>;
  getVehicleTrustScore: (vehicleId: string) => Promise<number>;
  hasVehicles: boolean;
  loading: boolean;
  vehicles: any[];
  ensureUserHasVehicle: (userId: string) => Promise<string | null>;
}

// Create the context with default values
const VehicleIdentityContext = createContext<VehicleIdentityContextType>({
  isVerifyingIdentity: false,
  verificationLevel: 'unverified',
  verifiedVehicleCount: 0,
  trustScore: 0,
  verifyVehicleIdentity: async () => false,
  getVehicleTrustScore: async () => 0,
  hasVehicles: false,
  loading: true,
  vehicles: [],
  ensureUserHasVehicle: async () => null
});

// Hook to use the vehicle identity context
export const useVehicleIdentity = () => {
  const context = useContext(VehicleIdentityContext);
  if (!context) {
    throw new Error('useVehicleIdentity must be used within a VehicleIdentityProvider');
  }
  return context;
};

interface VehicleIdentityProviderProps {
  children: React.ReactNode;
}

export const VehicleIdentityProvider: React.FC<VehicleIdentityProviderProps> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVerifyingIdentity, setIsVerifyingIdentity] = useState(false);
  const [verificationLevel, setVerificationLevel] = useState<VerificationLevel>('unverified');
  const [verifiedVehicleCount, setVerifiedVehicleCount] = useState(0);
  const [trustScore, setTrustScore] = useState(0);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehiclesLoaded, setVehiclesLoaded] = useState(false);

  // Function to ensure a user has at least one vehicle
  const ensureUserHasVehicle = async (userId: string) => {
    try {
      console.log("Ensuring user has at least one vehicle");
      const { data, error } = await supabase
        .rpc('ensure_user_has_vehicle', { user_uuid: userId });
        
      if (error) throw error;
      
      // Reload vehicle data after ensuring a vehicle exists
      loadVerificationData(userId);
      
      return data as string; // vehicle ID
    } catch (error) {
      console.error('Error ensuring vehicle exists:', error);
      return null;
    }
  };

  // Listen to auth changes directly instead of using useAuth
  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setIsAuthenticated(!!data.session);
      
      if (data.session) {
        await loadVerificationData(data.session.user.id);
      }
      setLoading(false);
    };
    
    getInitialSession();
    
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setLoading(true);
        setSession(newSession);
        setIsAuthenticated(!!newSession);
        
        if (newSession) {
          await loadVerificationData(newSession.user.id);
        } else {
          // Reset state when not authenticated
          setVerificationLevel('unverified');
          setVerifiedVehicleCount(0);
          setTrustScore(0);
          setVehicles([]);
          setVehiclesLoaded(false);
        }
        setLoading(false);
      }
    );
    
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Function to load verification data for the user
  const loadVerificationData = async (userId: string) => {
    try {
      // Get all verified vehicles for the user
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, verification_level, trust_score, make, model, year')
        .eq('user_id', userId);

      if (error) throw error;

      // Store all vehicles for vehicle-centric navigation
      setVehicles(vehicles || []);
      setVehiclesLoaded(true);
      
      if (vehicles && vehicles.length > 0) {
        // Count verified vehicles
        const verified = vehicles.filter(v => v.verification_level !== 'unverified');
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
        }

        // Calculate average trust score
        const avgScore = vehicles.reduce((sum, v) => sum + (v.trust_score || 0), 0) / vehicles.length;
        setTrustScore(Math.round(avgScore));
      } else if (userId) {
        // No vehicles found - call ensure_user_has_vehicle to create one
        await ensureUserHasVehicle(userId);
      }
    } catch (error) {
      console.error('Error loading vehicle verification data:', error);
    }
  };

  // Function to verify vehicle identity
  const verifyVehicleIdentity = async (vehicleId: string): Promise<boolean> => {
    if (!isAuthenticated || !session) return false;

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
      if (vehicle.user_id !== session.user.id) {
        throw new Error('Unauthorized: You can only verify vehicles you own');
      }

      // Process verification (simplified for this implementation)
      // In production this would involve more complex verification steps
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

      // Reload verification data
      await loadVerificationData(session.user.id);
      return true;
    } catch (error) {
      console.error('Error verifying vehicle identity:', error);
      return false;
    } finally {
      setIsVerifyingIdentity(false);
    }
  };

  // Function to get trust score for a specific vehicle
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

  const value: VehicleIdentityContextType = {
    isVerifyingIdentity,
    verificationLevel,
    verifiedVehicleCount,
    trustScore,
    verifyVehicleIdentity,
    getVehicleTrustScore,
    hasVehicles: vehicles.length > 0,
    loading,
    vehicles,
    ensureUserHasVehicle
  };

  return (
    <VehicleIdentityContext.Provider value={value}>
      {children}
    </VehicleIdentityContext.Provider>
  );
};

export default VehicleIdentityProvider;
