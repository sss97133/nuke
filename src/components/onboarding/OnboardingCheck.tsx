
import React, { useEffect, useState } from 'react';
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
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    // Skip this check for onboarding page, login page, and auth callback
    const skipPaths = ['/onboarding', '/login', '/register', '/auth/callback'];
    const isSkipPath = skipPaths.some(path => location.pathname.startsWith(path));
    
    // Don't redirect if we're already loading or on an exempt page
    if (isSkipPath || authLoading || isLoading || hasRedirected) {
      return;
    }
    
    // Only redirect brand new users who haven't seen onboarding yet
    if (session && isCompleted === false && location.pathname !== '/onboarding' && 
        localStorage.getItem('onboarding-shown') !== 'true') {
      
      // Set the flag to prevent multiple redirects
      setHasRedirected(true);
      localStorage.setItem('onboarding-shown', 'true');
      
      // Use a small delay to prevent UI glitching during navigation
      setTimeout(() => {
        navigate('/onboarding');
      }, 100);
    }
  }, [isCompleted, isLoading, authLoading, session, navigate, location.pathname, hasRedirected]);

  return <>{children}</>;
};

export default OnboardingCheck;
