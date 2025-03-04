
import { useState, useEffect } from 'react';
import { OnboardingState, OnboardingHook } from './types';
import { fetchUserOnboardingStatus, updateUserOnboardingProgress } from './api';

export const useOnboarding = (): OnboardingHook => {
  const [state, setState] = useState<OnboardingState>({
    currentStep: 0,
    completedSteps: [],
    isCompleted: false,
    isLoading: true,
  });

  useEffect(() => {
    fetchOnboardingStatus();
  }, []);

  const fetchOnboardingStatus = async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true }));
      
      const profile = await fetchUserOnboardingStatus();
      
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
      const success = await updateUserOnboardingProgress(step, completed);
      
      if (!success) {
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
