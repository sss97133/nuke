
import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAuthState } from '@/hooks/auth/use-auth-state';

interface OnboardingCheckProps {
  children: React.ReactNode;
}

export const OnboardingCheck: React.FC<OnboardingCheckProps> = ({ children }) => {
  const { isCompleted, isLoading } = useOnboarding();
  const { loading: authLoading, session } = useAuthState();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Skip this check for onboarding page, login page, and auth callback
    const skipPaths = ['/onboarding', '/login', '/register', '/auth/callback'];
    const isSkipPath = skipPaths.some(path => location.pathname.startsWith(path));
    
    if (isSkipPath || authLoading || isLoading) {
      return; // Still loading or on an exempt page
    }
    
    // If the user is authenticated but hasn't completed onboarding
    if (session && !isCompleted && location.pathname !== '/onboarding') {
      navigate('/onboarding');
    }
  }, [isCompleted, isLoading, authLoading, session, navigate, location.pathname]);

  return <>{children}</>;
};

export default OnboardingCheck;
