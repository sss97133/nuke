/**
 * Adaptive UI System
 * 
 * This module provides utilities for creating an AI-manipulated UI that adapts
 * to user behavior and preferences over time.
 */

import { supabase } from '@/integrations/supabase/client';

// Types for user interaction tracking
export interface UserInteraction {
  elementId?: string;
  elementType: string;
  actionType: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

// Types for UI preferences
export interface UIPreferences {
  theme: 'light' | 'dark' | 'system';
  density: 'compact' | 'comfortable' | 'spacious';
  colorAccent?: string;
  fontScale?: number;
  animations: boolean;
  customizations: Record<string, any>;
}

// Default UI preferences
export const defaultUIPreferences: UIPreferences = {
  theme: 'system',
  density: 'comfortable',
  animations: true,
  customizations: {}
};

// User interaction tracking
export const trackInteraction = async (interaction: UserInteraction): Promise<void> => {
  try {
    // Store interaction in localStorage first (for offline support)
    const storedInteractions = localStorage.getItem('userInteractions');
    const interactions = storedInteractions ? JSON.parse(storedInteractions) : [];
    interactions.push(interaction);
    localStorage.setItem('userInteractions', JSON.stringify(interactions.slice(-100))); // Keep last 100
    
    // If user is logged in, sync to Supabase
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Only sync if we have a valid database connection
      try {
        const { error } = await supabase
          .from('user_interactions')
          .insert([{
            user_id: user.id,
            element_id: interaction.elementId,
            element_type: interaction.elementType,
            action_type: interaction.actionType,
            timestamp: new Date(interaction.timestamp).toISOString(),
            metadata: interaction.metadata
          }]);
        
        if (error) console.error('Failed to sync interaction:', error);
      } catch (err) {
        // Fail silently - we've already stored locally
        console.warn('Could not sync interaction with server:', err);
      }
    }
  } catch (error) {
    console.error('Error tracking interaction:', error);
  }
};

// Get user preferences (combines stored and calculated preferences)
export const getUserPreferences = async (): Promise<UIPreferences> => {
  try {
    // First check localStorage
    const storedPrefs = localStorage.getItem('uiPreferences');
    const localPrefs = storedPrefs ? JSON.parse(storedPrefs) : {};
    
    // Merge with defaults
    const preferences = {
      ...defaultUIPreferences,
      ...localPrefs
    };
    
    // If user is logged in, check for server preferences
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      try {
        const { data, error } = await supabase
          .from('user_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();
        
        if (data && !error) {
          // Merge server preferences with higher priority
          Object.assign(preferences, {
            theme: data.theme || preferences.theme,
            density: data.density || preferences.density,
            colorAccent: data.color_accent || preferences.colorAccent,
            fontScale: data.font_scale || preferences.fontScale,
            animations: data.animations !== undefined ? data.animations : preferences.animations,
            customizations: data.customizations || preferences.customizations
          });
        }
      } catch (err) {
        // Fail silently - we'll use localStorage values
        console.warn('Could not fetch preferences from server:', err);
      }
    }
    
    return preferences;
  } catch (error) {
    console.error('Error getting user preferences:', error);
    return defaultUIPreferences;
  }
};

// Save user preferences
export const saveUserPreferences = async (preferences: Partial<UIPreferences>): Promise<void> => {
  try {
    // Get current preferences
    const storedPrefs = localStorage.getItem('uiPreferences');
    const currentPrefs = storedPrefs ? JSON.parse(storedPrefs) : defaultUIPreferences;
    
    // Merge new preferences
    const updatedPrefs = {
      ...currentPrefs,
      ...preferences
    };
    
    // Save to localStorage
    localStorage.setItem('uiPreferences', JSON.stringify(updatedPrefs));
    
    // If user is logged in, sync to Supabase
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      try {
        const { error } = await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            theme: updatedPrefs.theme,
            density: updatedPrefs.density,
            color_accent: updatedPrefs.colorAccent,
            font_scale: updatedPrefs.fontScale,
            animations: updatedPrefs.animations,
            customizations: updatedPrefs.customizations,
            updated_at: new Date().toISOString()
          });
        
        if (error) console.error('Failed to sync preferences:', error);
      } catch (err) {
        // Fail silently - we've already stored locally
        console.warn('Could not sync preferences with server:', err);
      }
    }
  } catch (error) {
    console.error('Error saving user preferences:', error);
  }
};

// Apply UI preferences to DOM
export const applyUIPreferences = (preferences: UIPreferences): void => {
  // Apply theme
  const isDark = preferences.theme === 'dark' || 
    (preferences.theme === 'system' && 
     window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  
  // Apply density
  document.documentElement.dataset.density = preferences.density;
  
  // Apply custom accent color if set
  if (preferences.colorAccent) {
    document.documentElement.style.setProperty('--accent-color', preferences.colorAccent);
  }
  
  // Apply font scaling
  if (preferences.fontScale) {
    document.documentElement.style.setProperty('--font-scale', preferences.fontScale.toString());
  }
  
  // Apply animation preferences
  if (!preferences.animations) {
    document.documentElement.classList.add('reduce-motion');
  } else {
    document.documentElement.classList.remove('reduce-motion');
  }
  
  // Apply custom properties from the customizations object
  if (preferences.customizations) {
    Object.entries(preferences.customizations).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value as string);
    });
  }
};

// Get recommended UI modifications based on user behavior
export const getRecommendedUIModifications = async (): Promise<Partial<UIPreferences>> => {
  // This would normally call an ML service, but for now we'll use simple heuristics
  try {
    // Get stored interactions
    const storedInteractions = localStorage.getItem('userInteractions');
    if (!storedInteractions) return {};
    
    const interactions = JSON.parse(storedInteractions) as UserInteraction[];
    const recommendations: Partial<UIPreferences> = {};
    
    // Example logic: if user interacts with the same element type multiple times,
    // adjust the UI accordingly (simplified for illustration)
    const elementTypeCounts: Record<string, number> = {};
    interactions.forEach(i => {
      elementTypeCounts[i.elementType] = (elementTypeCounts[i.elementType] || 0) + 1;
    });
    
    // Example: user clicks many buttons, make them more prominent
    if (elementTypeCounts['button'] > 20) {
      recommendations.customizations = {
        ...(recommendations.customizations || {}),
        'button-scale': '1.05'
      };
    }
    
    // Example: user toggles theme multiple times, they might prefer system
    const themeToggles = interactions.filter(i => i.elementId === 'theme-toggle').length;
    if (themeToggles > 3) {
      recommendations.theme = 'system';
    }
    
    return recommendations;
  } catch (error) {
    console.error('Error generating UI recommendations:', error);
    return {};
  }
};
