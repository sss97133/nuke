import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowRight, Github, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase-client";

type AuthMode = "signin" | "signup";

export const EnhancedSignInForm: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      // For testing purposes, provide a specific test user
      // You can use these credentials for testing: dev@example.com / developer123
      console.log('Attempting login with:', { email });
      
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (signInError) {
        throw signInError;
      }
      
      console.log('Login successful');
      // Let the auth provider handle the redirect
    } catch (err: any) {
      console.error("Sign in error:", err);
      setError("Invalid login credentials. Try using dev@example.com / developer123 for testing.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError("Please fill in all fields");
      return;
    }
    
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });
      
      if (signUpError) {
        throw signUpError;
      }
      
      // Success message - don't navigate, let the user know to check their email
      setMode("signin");
      setEmail("");
      setPassword("");
      // Display success message
    } catch (err: any) {
      console.error("Sign up error:", err);
      setError(err.message || "Failed to create account. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'github' | 'google') => {
    try {
      setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  const handleAnonymousSignIn = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Sign in anonymously
      const { data, error } = await supabase.auth.signInAnonymously();
      
      if (error) throw error;
      
      console.log('Anonymous login successful', data);
      
      // Let the auth provider handle the redirect
    } catch (err: any) {
      console.error("Anonymous sign in error:", err);
      setError(err.message || "Failed to sign in anonymously. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setEmail("");
    setPassword("");
    setError(null);
  };

  const passwordStrength = (): { strength: string; color: string } => {
    if (!password) return { strength: "No password", color: "text-gray-400" };
    if (password.length < 8) return { strength: "Weak", color: "text-red-500" };
    if (password.length < 12) return { strength: "Medium", color: "text-yellow-500" };
    return { strength: "Strong", color: "text-green-500" };
  };

  const { strength, color } = passwordStrength();

  return (
    <div className="w-full">
      {/* Mode Switcher */}
      <div className="flex mb-8 border-b">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`pb-2 px-4 text-lg font-medium ${
            mode === "signin"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground"
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`pb-2 px-4 text-lg font-medium ${
            mode === "signup"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground"
          }`}
        >
          Create Account
        </button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6 border-2 border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="font-medium">{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
          <Input
            id="email"
            type="email"
            placeholder="yourname@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12"
            disabled={isLoading}
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium">Password</Label>
            {mode === "signin" && (
              <Link 
                to="/reset-password"
                className="text-sm text-primary hover:underline font-medium"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 pr-10"
              disabled={isLoading}
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
          className="w-full h-12 text-base font-medium shadow-md hover:shadow-lg transition-all" 
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </span>
          ) : (
            <span className="flex items-center justify-center">
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
            type="button"
            variant="outline" 
            className="h-12"
            onClick={() => handleSocialLogin('github')}
            disabled={isLoading}
          >
            <Github size={18} className="mr-2" />
            GitHub
          </Button>
          <Button 
            type="button"
            variant="outline" 
            className="h-12"
            onClick={() => handleSocialLogin('google')}
            disabled={isLoading}
          >
            <svg
              className="mr-2 h-4 w-4"
              viewBox="0 0 24 24"
            >
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google
          </Button>
        </div>

        <Button 
          type="button"
          variant="ghost" 
          className="w-full mt-4 h-12" 
          onClick={handleAnonymousSignIn}
          disabled={isLoading}
        >
          <User size={18} className="mr-2" />
          Continue as Guest
        </Button>
      </div>

      <div className="mt-8 text-center text-sm text-muted-foreground">
        <div className="mb-2">
          {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button"
            onClick={toggleMode}
            className="text-primary hover:underline font-medium"
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </div>
        <div>
          <Link to="/terms" className="hover:underline">Terms of Service</Link>
          {" · "}
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
          {" · "}
          <Link to="/help" className="hover:underline">Help</Link>
        </div>
      </div>
    </div>
  );
};

export default EnhancedSignInForm;
