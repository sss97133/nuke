import { useState, useEffect, useCallback } from 'react';
import { 
  UIPreferences, 
  defaultUIPreferences,
  getUserPreferences, 
  saveUserPreferences,
  trackInteraction,
  applyUIPreferences,
  getRecommendedUIModifications,
  UserInteraction
} from '@/utils/adaptive-ui';

/**
 * Hook for using the adaptive UI system in React components
 * This provides state management and methods for the AI-driven UI modifications
 */
export function useAdaptiveUI() {
  const [preferences, setPreferences] = useState<UIPreferences>(defaultUIPreferences);
  const [isLoading, setIsLoading] = useState(true);
  const [hasRecommendations, setHasRecommendations] = useState(false);

  // Load user preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const userPrefs = await getUserPreferences();
        setPreferences(userPrefs);
        applyUIPreferences(userPrefs);
        setIsLoading(false);
        
        // Check for recommended changes based on past behavior
        const recommendations = await getRecommendedUIModifications();
        setHasRecommendations(Object.keys(recommendations).length > 0);
      } catch (error) {
        console.error('Error loading UI preferences:', error);
        setIsLoading(false);
      }
    };
    
    loadPreferences();
  }, []);
  
  // Update theme preference
  const setTheme = useCallback(async (theme: UIPreferences['theme']) => {
    try {
      const newPreferences = { ...preferences, theme };
      setPreferences(newPreferences);
      applyUIPreferences(newPreferences);
      await saveUserPreferences({ theme });
      
      // Track this interaction
      await trackInteraction({
        elementId: 'theme-toggle',
        elementType: 'button',
        actionType: 'click',
        timestamp: Date.now(),
        metadata: { newTheme: theme }
      });
    } catch (error) {
      console.error('Error updating theme:', error);
    }
  }, [preferences]);
  
  // Update density preference
  const setDensity = useCallback(async (density: UIPreferences['density']) => {
    try {
      const newPreferences = { ...preferences, density };
      setPreferences(newPreferences);
      applyUIPreferences(newPreferences);
      await saveUserPreferences({ density });
      
      await trackInteraction({
        elementId: 'density-selector',
        elementType: 'select',
        actionType: 'change',
        timestamp: Date.now(),
        metadata: { newDensity: density }
      });
    } catch (error) {
      console.error('Error updating density:', error);
    }
  }, [preferences]);
  
  // Update accent color
  const setAccentColor = useCallback(async (colorAccent: string) => {
    try {
      const newPreferences = { ...preferences, colorAccent };
      setPreferences(newPreferences);
      applyUIPreferences(newPreferences);
      await saveUserPreferences({ colorAccent });
      
      await trackInteraction({
        elementId: 'accent-color-picker',
        elementType: 'color-picker',
        actionType: 'change',
        timestamp: Date.now(),
        metadata: { newColor: colorAccent }
      });
    } catch (error) {
      console.error('Error updating accent color:', error);
    }
  }, [preferences]);
  
  // Update font scale
  const setFontScale = useCallback(async (fontScale: number) => {
    try {
      const newPreferences = { ...preferences, fontScale };
      setPreferences(newPreferences);
      applyUIPreferences(newPreferences);
      await saveUserPreferences({ fontScale });
      
      await trackInteraction({
        elementId: 'font-scale-slider',
        elementType: 'slider',
        actionType: 'change',
        timestamp: Date.now(),
        metadata: { newScale: fontScale }
      });
    } catch (error) {
      console.error('Error updating font scale:', error);
    }
  }, [preferences]);
  
  // Toggle animations
  const toggleAnimations = useCallback(async () => {
    try {
      const newAnimations = !preferences.animations;
      const newPreferences = { ...preferences, animations: newAnimations };
      setPreferences(newPreferences);
      applyUIPreferences(newPreferences);
      await saveUserPreferences({ animations: newAnimations });
      
      await trackInteraction({
        elementId: 'animations-toggle',
        elementType: 'toggle',
        actionType: 'click',
        timestamp: Date.now(),
        metadata: { enabled: newAnimations }
      });
    } catch (error) {
      console.error('Error toggling animations:', error);
    }
  }, [preferences]);
  
  // Track any UI interaction
  const trackUIInteraction = useCallback(async (interaction: Omit<UserInteraction, 'timestamp'>) => {
    try {
      await trackInteraction({
        ...interaction,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error tracking interaction:', error);
    }
  }, []);
  
  // Apply AI recommendations
  const applyRecommendations = useCallback(async () => {
    try {
      const recommendations = await getRecommendedUIModifications();
      if (Object.keys(recommendations).length > 0) {
        const newPreferences = { ...preferences, ...recommendations };
        setPreferences(newPreferences);
        applyUIPreferences(newPreferences);
        await saveUserPreferences(recommendations);
        setHasRecommendations(false);
        
        await trackInteraction({
          elementId: 'apply-recommendations',
          elementType: 'button',
          actionType: 'click',
          timestamp: Date.now(),
          metadata: { recommendations }
        });
        
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error applying recommendations:', error);
      return false;
    }
  }, [preferences]);
  
  return {
    preferences,
    isLoading,
    hasRecommendations,
    setTheme,
    setDensity,
    setAccentColor,
    setFontScale,
    toggleAnimations,
    trackUIInteraction,
    applyRecommendations
  };
}
