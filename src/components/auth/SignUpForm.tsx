import type { Database } from '../types';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { ProfileAnalysisService } from '@/components/profile/services/ProfileAnalysisService';

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
      const { data, error } = await supabase.auth.signUp({
  if (error) console.error("Database query error:", error);
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        // Create initial profile
        const { error: profileError } = await supabase
  if (error) console.error("Database query error:", error);
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
  if (error) console.error("Database query error:", error);
            
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
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create account',
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