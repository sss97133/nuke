
import React, { useEffect } from 'react';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { useNavigate, NavigateFunction } from 'react-router-dom';
import { useOnboarding } from '@/hooks/useOnboarding';

interface OnboardingCheckProps {
  children: React.ReactNode;
}

// Component to conditionally redirect users to onboarding if needed
const OnboardingCheckContent: React.FC<{ navigate: NavigateFunction }> = ({ navigate }) => {
  const { session } = useAuthState();
  const { isCompleted, isLoading } = useOnboarding();
  
  useEffect(() => {
    // Only redirect if:
    // 1. User is authenticated
    // 2. Onboarding status is loaded (not loading)
    // 3. Onboarding is not completed
    // 4. Current path is not already onboarding
    if (session && !isLoading && !isCompleted && window.location.pathname !== '/onboarding') {
      navigate('/onboarding');
    }
  }, [session, isCompleted, isLoading, navigate]);
  
  return null;
};

// Wrapper component that only uses the check when Router is available
const OnboardingCheck: React.FC<OnboardingCheckProps> = ({ children }) => {
  // Check if we're in a browser environment where Router is available
  const isBrowser = typeof window !== 'undefined';
  
  if (!isBrowser) {
    return <>{children}</>;
  }
  
  // Try/catch to handle cases where component might be rendered outside Router context
  try {
    // Use useNavigate in a conditional way to prevent errors
    const CheckWithRouter = () => {
      const navigate = useNavigate();
      return <OnboardingCheckContent navigate={navigate} />;
    };
    
    return (
      <>
        {/* Render the children */}
        {children}
        
        {/* Conditionally attempt to render the check */}
        <CheckWithRouter />
      </>
    );
  } catch (error) {
    console.warn('OnboardingCheck: Router context not available, skipping check');
    return <>{children}</>;
  }
};

export default OnboardingCheck;
