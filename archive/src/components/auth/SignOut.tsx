import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase-client';
import { Button, ButtonProps } from '@/components/ui/button';

interface SignOutProps extends ButtonProps {
  redirectTo?: string;
  onSignOut?: () => void;
}

const SignOut: React.FC<SignOutProps> = ({ 
  redirectTo = '/auth',
  onSignOut,
  children = 'Sign Out',
  variant = 'default',
  size = 'default',
  className,
  ...props
}) => {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        return;
      }
      
      // Call the onSignOut callback if provided
      if (onSignOut) {
        onSignOut();
      }
      
      // Redirect to the specified path
      navigate(redirectTo);
    } catch (error) {
      console.error('Error during sign out:', error);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleSignOut}
      {...props}
    >
      {children}
    </Button>
  );
};

export default SignOut;
