
import type { Database } from '../types';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useOnboarding() {
  const [isCompleted, setIsCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(5); // Default total steps
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      setIsLoading(true);
      
      try {
        // Get current user
        const { data: { session } } = await supabase.auth.getSession();
  if (error) console.error("Database query error:", error);
        if (!session?.user) {
          setIsLoading(false);
          return;
        }
        
        setUserId(session.user.id);
        
        // Check if the profiles table has onboarding data
        const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
          .from('profiles')
          .select('onboarding_completed, onboarding_step')
          .eq('id', session.user.id)
          .single();
          
        if (error) {
          console.error('Error checking onboarding status:', error);
          setIsLoading(false);
          return;
        }
        
        if (data) {
          setIsCompleted(data.onboarding_completed || false);
          setCurrentStep(data.onboarding_step || 0);
        }
      } catch (error) {
        console.error('Unexpected error checking onboarding:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    checkOnboardingStatus();
  }, []);
  
  const updateOnboardingStep = async (step: number, completed = false) => {
    if (!userId) return false;
    
    try {
      const { error } = await supabase
  if (error) console.error("Database query error:", error);
        
        .update({
          onboarding_step: step,
          onboarding_completed: completed,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
        
      if (error) throw error;
      
      setCurrentStep(step);
      setIsCompleted(completed);
      return true;
    } catch (error) {
      console.error('Error updating onboarding step:', error);
      return false;
    }
  };
  
  const completeOnboarding = async () => {
    return updateOnboardingStep(totalSteps, true);
  };
  
  const resetOnboarding = async () => {
    return updateOnboardingStep(0, false);
  };

  return {
    isCompleted,
    isLoading,
    currentStep,
    totalSteps,
    updateOnboardingStep,
    completeOnboarding,
    resetOnboarding
  };
}
