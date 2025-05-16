import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVehicle } from '@/providers/VehicleProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader } from 'lucide-react';

interface AuthUIProps {
  redirectTo?: string;
  showSignUp?: boolean;
  allowAnonymous?: boolean;
}

export const AuthUI: React.FC<AuthUIProps> = ({ 
  redirectTo = '/', 
  showSignUp = true,
  allowAnonymous = true
}) => {
  const navigate = useNavigate();
  const { signIn, isAnonymous, convertAnonymous, signInAnonymously } = useVehicle();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  
  // Handle sign in/up
  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const { error } = await signIn(email, password);
      
      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'You have been signed in',
      });
      
      navigate(redirectTo);
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication');
      toast({
        title: 'Authentication error',
        description: err.message || 'Failed to sign in',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  
  // Handle anonymous sign in
  const handleAnonymousAuth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { error } = await signInAnonymously();
      
      if (error) throw error;
      
      toast({
        title: 'Welcome',
        description: 'You are now browsing anonymously. Create an account later to save your data.',
      });
      
      navigate(redirectTo);
    } catch (err: any) {
      setError(err.message || 'An error occurred during anonymous authentication');
      toast({
        title: 'Authentication error',
        description: err.message || 'Failed to sign in anonymously',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{isSignUp ? 'Create an account' : 'Sign in'}</CardTitle>
        <CardDescription>
          {isSignUp 
            ? 'Create an account to start tracking your vehicles'
            : 'Sign in to access your vehicle dashboard'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
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
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          
          <Button
            type="submit"
            className="w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
            )}
          </Button>
        </form>
        
        {allowAnonymous && (
          <div className="mt-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">Or continue with</span>
              </div>
            </div>
            
            <Button
              variant="outline"
              onClick={handleAnonymousAuth}
              className="w-full mt-4"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Continue Anonymously</span>
              )}
            </Button>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-center">
        <Button 
          variant="link"
          onClick={() => setIsSignUp(!isSignUp)}
        >
          {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
        </Button>
      </CardFooter>
    </Card>
  );
};



export default AuthUI;
