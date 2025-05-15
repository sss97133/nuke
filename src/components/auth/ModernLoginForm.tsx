import React, { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase-client';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, Github, Car, Shield, Gauge, Database, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

export const ModernLoginForm: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  
  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }
    
    setError(null);
    setLoading(true);
    
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        
        if (error) throw error;
        
        toast({
          title: "Signed in successfully",
          description: "Welcome back to the Nuke vehicle management platform!",
        });
        // Will be redirected by AuthProvider
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        });
        
        if (error) throw error;
        
        toast({
          title: "Account created",
          description: "Please check your email for verification instructions.",
        });
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      setError(err.message || 'An unexpected error occurred');
      toast({
        title: "Authentication failed",
        description: err.message || "Please check your credentials and try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };
  
  const handleSocialLogin = async (provider: 'github' | 'google') => {
    try {
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: {
            state: JSON.stringify({
              returnTo: '/dashboard',
              timestamp: Date.now()
            })
          }
        }
      });
      
      if (error) throw error;
      if (!data.url) throw new Error('No redirect URL returned');
      
      // Redirect to provider's login page
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || 'Failed to login with social provider');
      toast({
        title: "Authentication failed",
        description: "Could not login with social provider. Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };
  
  const handleGuestAccess = () => {
    toast({
      title: "Continuing as guest",
      description: "You'll have limited access to the platform features.",
    });
    navigate('/explore');
  };
  
  const passwordStrength = (): { strength: string; color: string } => {
    if (!password) return { strength: "No password", color: "text-gray-400" };
    if (password.length < 8) return { strength: "Weak", color: "text-red-500" };
    if (password.length < 12) return { strength: "Medium", color: "text-yellow-500" };
    return { strength: "Strong", color: "text-green-500" };
  };
  
  const { strength, color } = passwordStrength();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Vehicle Identity Branding Panel */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-8 flex flex-col justify-center items-center md:w-2/5">
        <div className="max-w-md mx-auto text-center">
          <div className="mb-6 text-4xl font-bold">NUKE</div>
          <h1 className="text-3xl font-bold mb-6">
            Vehicle-Centric Digital Identity Platform
          </h1>
          <p className="text-xl mb-8">
            Creating persistent digital identities for vehicles throughout their lifecycle.
          </p>
          
          {/* Vehicle identity trust mechanisms */}
          <div className="mt-10 text-left space-y-6">
            <div className="flex items-start space-x-3">
              <div className="mt-0.5 bg-white/10 p-2 rounded-full">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium">Trust Verification</h3>
                <p className="text-sm opacity-80">Multi-layer verification with blockchain validation</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="mt-0.5 bg-white/10 p-2 rounded-full">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium">Confidence Scoring</h3>
                <p className="text-sm opacity-80">Advanced reliability metrics for all vehicle data</p>
              </div>
            </div>
            
            <div className="flex items-start space-x-3">
              <div className="mt-0.5 bg-white/10 p-2 rounded-full">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-medium">Immutable History</h3>
                <p className="text-sm opacity-80">Complete timeline of verified vehicle events</p>
              </div>
            </div>
          </div>
          
          <div className="text-sm opacity-80 mt-10">
            Trusted by 12,000+ vehicle owners & professionals
          </div>
        </div>
      </div>

      {/* Auth Form Panel */}
      <div className="flex-1 flex justify-center items-center p-4 sm:p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Mode Switcher */}
          <div className="flex mb-8 border-b">
            <button
              onClick={() => setMode('signin')}
              className={`pb-2 px-4 text-lg font-medium ${
                mode === "signin"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setMode('signup')}
              className={`pb-2 px-4 text-lg font-medium ${
                mode === "signup"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
            >
              Create account
            </button>
          </div>

          {/* Error display */}
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" && (
                  <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signin" ? "••••••••" : "Create a secure password"}
                  required
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              
              {mode === "signup" && (
                <div className={`text-sm ${color} mt-1`}>
                  Password strength: {strength}
                </div>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base" 
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                <span className="flex items-center">
                  {mode === "signin" ? "Sign in" : "Create account"}
                  <ArrowRight className="ml-2" size={18} />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-8">
            <div className="relative flex items-center">
              <div className="flex-grow border-t border-border"></div>
              <span className="flex-shrink mx-4 text-muted-foreground text-sm">
                or continue with
              </span>
              <div className="flex-grow border-t border-border"></div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <Button 
                variant="outline" 
                className="h-12"
                onClick={() => handleSocialLogin('github')}
                disabled={loading}
              >
                <Github size={18} className="mr-2" />
                GitHub
              </Button>
              <Button 
                variant="outline" 
                className="h-12"
                onClick={() => handleSocialLogin('google')}
                disabled={loading}
              >
                <svg
                  className="mr-2 h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M8 12h8"></path>
                  <path d="M12 8v8"></path>
                </svg>
                Google
              </Button>
            </div>

            <Button 
              variant="ghost" 
              className="w-full mt-4 h-12" 
              onClick={handleGuestAccess}
            >
              Continue as Guest
            </Button>
          </div>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            <div className="mb-2">
              {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
              <button 
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="text-primary hover:underline"
              >
                {mode === "signin" ? "Create one" : "Sign in"}
              </button>
            </div>
            <div>
              <Link to="/terms" className="hover:underline">Terms of Service</Link>
              {" · "}
              <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
              {" · "}
              <Link to="/support" className="hover:underline">Help</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
