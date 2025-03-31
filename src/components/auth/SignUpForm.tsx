import type { Database } from '@/types/database';
import { useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { ProfileAnalysisService } from '@/components/profile/services/ProfileAnalysisService';
import { DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function SignUpForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Check if email already exists before attempting signup
      const { data: emailCheck } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      
      if (emailCheck) {
        // Email already exists, handle this case specifically
        throw new Error('EMAIL_EXISTS');
      }

      // Validate password strength
      if (password.length < 8) {
        throw new Error('PASSWORD_TOO_SHORT');
      }

      // Contains at least one number and one special character
      const hasNumber = /\d/.test(password);
      const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

      if (!hasNumber || !hasSpecial) {
        throw new Error('PASSWORD_REQUIREMENTS');
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        // Create initial profile
        const { error: profileError } = await supabase
        .from('profiles')
          .insert({
            id: data.user.id,
            email: data.user.email,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (profileError) throw profileError;

        // Trigger initial profile analysis
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

          if (profile) {
            await ProfileAnalysisService.analyzeProfile(
              profile,
              [], // achievements
              {}, // socialLinks
              {}  // streamingLinks
            );
          }
        } catch (analysisError) {
          console.error('Error during profile analysis:', analysisError);
          // Don't block signup if analysis fails
        }

        toast({
          title: 'Success',
          description: 'Account created successfully!',
        });

        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Signup error:', error);
      let errorTitle = 'Signup Error';
      let errorMessage = 'Failed to create account';
      let errorAction: React.ReactNode = null;

      if (error instanceof Error) {
        // Handle specific error cases
        if (error.message === 'EMAIL_EXISTS') {
          errorTitle = 'Email Already Registered';
          errorMessage = 'An account with this email already exists';
          errorAction = (
            <Button variant="outline" className="mt-2" onClick={() => navigate('/login')}>
              Go to Login
            </Button>
          );
        } else if (error.message === 'PASSWORD_TOO_SHORT') {
          errorTitle = 'Password Too Short';
          errorMessage = 'Password must be at least 8 characters long';
        } else if (error.message === 'PASSWORD_REQUIREMENTS') {
          errorTitle = 'Password Requirements';
          errorMessage = 'Password must contain at least one number and one special character';
        } else if (error.message.includes('already registered')) {
          errorTitle = 'Account Already Exists';
          errorMessage = 'An account with this email already exists';
          errorAction = (
            <Button variant="outline" className="mt-2" onClick={() => navigate('/login')}>
              Go to Login
            </Button>
          );
        } else if (error.message.includes('weak password')) {
          errorTitle = 'Weak Password';
          errorMessage = 'Please choose a stronger password with at least 8 characters, numbers, and special characters';
        } else {
          errorMessage = error.message;
        }
      }

      toast({
        title: errorTitle,
        description: (
          <div className="space-y-2">
            <p>{errorMessage}</p>
            {errorAction}
          </div>
        ) as ReactNode,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSignUp} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Creating account...' : 'Sign Up'}
      </Button>
    </form>
  );
} 