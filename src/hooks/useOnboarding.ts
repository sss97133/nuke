
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
        if (!session?.user) {
          setIsLoading(false);
          return;
        }
        
        setUserId(session.user.id);
        
        // Check onboarding status
        const { data, error } = await supabase
          .from('onboarding')
          .select('*')
          .eq('user_id', session.user.id)
          .single();
          
        if (error && error.code !== 'PGRST116') {
          console.error('Error checking onboarding status:', error);
          setIsLoading(false);
          return;
        }
        
        if (data) {
          setIsCompleted(data.is_completed || false);
          setCurrentStep(data.current_step || 0);
          setTotalSteps(data.total_steps || 5);
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
        .from('onboarding')
        .upsert({
          user_id: userId,
          current_step: step,
          is_completed: completed,
          total_steps: totalSteps,
          updated_at: new Date().toISOString()
        });
        
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
