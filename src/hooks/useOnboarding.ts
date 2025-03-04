
import { useState, useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface OnboardingState {
  currentStep: number;
  completedSteps: number[];
  isCompleted: boolean;
  isLoading: boolean;
}

export const useOnboarding = () => {
  const [state, setState] = useState<OnboardingState>({
    currentStep: 0,
    completedSteps: [],
    isCompleted: false,
    isLoading: true,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchOnboardingStatus();
  }, []);

  const fetchOnboardingStatus = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true }));
      
      // Get current user 
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }
      
      // Fetch the user's profile including onboarding information
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('onboarding_step, onboarding_completed')
        .eq('id', user.id)
        .single();
        
      if (error) {
        console.error("Error fetching profile:", error);
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }
      
      if (profile) {
        const step = profile.onboarding_step || 0;
        const completed = profile.onboarding_completed || false;
        
        // Setup completed steps
        const completedSteps: number[] = [];
        for (let i = 0; i < step; i++) {
          completedSteps.push(i);
        }
        
        setState({
          currentStep: step,
          completedSteps,
          isCompleted: completed,
          isLoading: false,
        });
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error("Error in onboarding hook:", error);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const updateOnboardingStep = async (step: number, completed: boolean = false) => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast({
          title: "Not signed in",
          description: "Please sign in to save your progress",
          variant: "destructive",
        });
        return false;
      }
      
      // Update the onboarding step in the database
      const { error } = await supabase
        .from('profiles')
        .update({
          onboarding_step: step,
          onboarding_completed: completed,
        })
        .eq('id', user.id);
        
      if (error) {
        console.error("Error updating onboarding progress:", error);
        toast({
          title: "Error",
          description: "Could not save your progress",
          variant: "destructive",
        });
        return false;
      }
      
      // Update local state
      setState(prev => {
        const completedSteps = [...prev.completedSteps];
        if (!completedSteps.includes(step - 1) && step > 0) {
          completedSteps.push(step - 1);
        }
        
        return {
          currentStep: step,
          completedSteps,
          isCompleted: completed,
          isLoading: false,
        };
      });
      
      return true;
    } catch (error) {
      console.error("Error updating onboarding:", error);
      return false;
    }
  };

  const completeOnboarding = async () => {
    return await updateOnboardingStep(state.currentStep, true);
  };

  const resetOnboarding = async () => {
    return await updateOnboardingStep(0, false);
  };

  return {
    ...state,
    updateOnboardingStep,
    completeOnboarding,
    resetOnboarding,
    refreshStatus: fetchOnboardingStatus,
  };
};
