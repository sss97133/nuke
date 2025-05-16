import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase-client';

// Define the user profile interface based on your existing database schema
export interface UserProfile {
  id: string;
  email?: string | null;
  avatar_url?: string | null;
  username?: string | null;
  full_name?: string | null;
  user_type?: string;
  onboarding_completed?: boolean;
  onboarding_step?: number;
  bio?: string;
  social_links?: Record<string, any>;
  streaming_links?: Record<string, any>;
  home_location?: { lat: number; lng: number };
  skills?: string[];
  ai_analysis?: Record<string, any>;
}

// Define the user interface
export interface User {
  id: string;
  email?: string | null;
  profile: UserProfile | null;
}

// Define the user store state
interface UserState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  
  // Actions
  setUser: (user: User | null) => void;
  setLoading: (isLoading: boolean) => void;
  setAuthenticated: (isAuthenticated: boolean) => void;
  
  // Async actions
  getCurrentUser: () => Promise<User | null>;
  signOut: () => Promise<void>;
}

// Create the user store
export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      
      // Synchronous actions
      setUser: (user) => set({ user }),
      setLoading: (isLoading) => set({ isLoading }),
      setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
      
      // Asynchronous actions
      getCurrentUser: async () => {
        try {
          set({ isLoading: true });
          
          // Check if we have a session
          const { data: sessionData } = await supabase.auth.getSession();
          
          if (!sessionData.session) {
            set({ isAuthenticated: false, user: null, isLoading: false });
            return null;
          }
          
          // Get the user data
          const { data: userData } = await supabase.auth.getUser();
          
          if (!userData.user) {
            set({ isAuthenticated: false, user: null, isLoading: false });
            return null;
          }
          
          // Fetch the user profile from the profiles table
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userData.user.id)
            .single();
          
          if (profileError && profileError.code !== 'PGRST116') {
            console.error('Error fetching user profile:', profileError);
          }
          
          // Create the user object
          const user: User = {
            id: userData.user.id,
            email: userData.user.email,
            profile: profileData || null
          };
          
          // Update the store
          set({ 
            user, 
            isAuthenticated: true, 
            isLoading: false 
          });
          
          return user;
        } catch (error) {
          console.error('Error getting current user:', error);
          set({ isLoading: false, isAuthenticated: false });
          return null;
        }
      },
      
      signOut: async () => {
        try {
          await supabase.auth.signOut();
          set({ user: null, isAuthenticated: false });
        } catch (error) {
          console.error('Error signing out:', error);
        }
      }
    }),
    {
      name: 'nuke-user-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
