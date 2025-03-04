
export interface OnboardingState {
  currentStep: number;
  completedSteps: number[];
  isCompleted: boolean;
  isLoading: boolean;
}

export interface OnboardingHook extends OnboardingState {
  updateOnboardingStep: (step: number, completed?: boolean) => Promise<boolean>;
  completeOnboarding: () => Promise<boolean>;
  resetOnboarding: () => Promise<boolean>;
  refreshStatus: () => Promise<void>;
}
