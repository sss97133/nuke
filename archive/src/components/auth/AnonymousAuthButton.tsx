import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase-client';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

interface AnonymousAuthButtonProps {
  label?: string;
  redirectTo?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link';
  className?: string;
}

export const AnonymousAuthButton: React.FC<AnonymousAuthButtonProps> = ({
  label = 'Continue as Guest',
  redirectTo = '/explore',
  variant = 'ghost',
  className = '',
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleAnonymousLogin = async () => {
    try {
      setIsLoading(true);
      
      // Sign in anonymously
      const { data, error } = await supabase.auth.signInAnonymously();
      
      if (error) throw error;
      
      console.log('Anonymous login successful', data);
      
      // Navigate to the specified route
      navigate(redirectTo);
    } catch (error: any) {
      console.error('Anonymous authentication error:', error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button 
      variant={variant} 
      onClick={handleAnonymousLogin} 
      disabled={isLoading}
      className={className}
    >
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {label}
    </Button>
  );
};

export default AnonymousAuthButton;
