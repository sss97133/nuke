import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, CheckCircle } from "lucide-react";
import { supabase } from "@/lib/supabase-client";

export const EnhancedPasswordResetForm: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [mode, setMode] = useState<"request" | "reset">("request");
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if we're coming from an auth callback with error
  useEffect(() => {
    const state = location.state as any;
    if (state?.authError) {
      setError("The password reset link is invalid or has expired. Please request a new one.");
    }
    
    // Check if we have a recovery token in the URL - if we do, we're in reset mode
    const params = new URLSearchParams(location.search);
    if (params.get("token")) {
      setMode("reset");
    }
  }, [location]);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      setError("Please enter your email address");
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      const { data, error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password?token=recovery`,
      });
      
      if (resetError) {
        throw resetError;
      }
      
      setIsSuccess(true);
    } catch (err: any) {
      console.error("Password reset error:", err);
      setError(err.message || "Failed to send password reset email. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password) {
      setError("Please enter a new password");
      return;
    }
    
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      // We're using updatePassword instead of direct resetPassword endpoint
      const { data, error: updateError } = await supabase.auth.updateUser({
        password: password
      });
      
      if (updateError) {
        throw updateError;
      }
      
      setIsSuccess(true);
      navigate('/login', { 
        replace: true,
        state: { passwordReset: true }
      });
    } catch (err: any) {
      console.error("Set new password error:", err);
      setError(err.message || "Failed to set new password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <Link 
        to="/login" 
        className="inline-flex items-center text-sm text-primary hover:underline mb-6"
      >
        <ArrowLeft size={16} className="mr-1" /> Back to sign in
      </Link>

      {error && (
        <Alert variant="destructive" className="mb-6 border-2 border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="font-medium">{error}</AlertDescription>
        </Alert>
      )}

      {mode === "request" ? (
        isSuccess ? (
          <div className="text-center py-8">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-xl font-medium mb-2">Check your inbox</h3>
            <p className="text-muted-foreground mb-6">
              We've sent a password reset link to <strong>{email}</strong>. 
              Please check your inbox (and spam folder) for instructions.
            </p>
            <Button 
              variant="outline" 
              onClick={() => {
                setEmail("");
                setIsSuccess(false);
              }}
              className="mr-4"
            >
              Try a different email
            </Button>
            <Link to="/login">
              <Button>Return to sign in</Button>
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold mb-2">Forgot your password?</h2>
            <p className="text-muted-foreground mb-6">
              No problem. Enter your email and we'll send you a reset link.
            </p>

            <form onSubmit={handleResetRequest} className="space-y-6">
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

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium shadow-md hover:shadow-lg transition-all" 
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center">
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    Sending...
                  </span>
                ) : (
                  <span className="flex items-center">
                    Send reset instructions
                    <ArrowRight className="ml-2" size={18} />
                  </span>
                )}
              </Button>
            </form>
          </>
        )
      ) : (
        // Password reset form
        <>
          <h2 className="text-2xl font-semibold mb-2">Set New Password</h2>
          <p className="text-muted-foreground mb-6">
            Create a new password for your account.
          </p>

          <form onSubmit={handleSetNewPassword} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">New Password</Label>
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
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-12 pr-10"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-12 text-base font-medium shadow-md hover:shadow-lg transition-all" 
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center">
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Processing...
                </span>
              ) : (
                <span className="flex items-center">
                  Set New Password
                  <ArrowRight className="ml-2" size={18} />
                </span>
              )}
            </Button>
          </form>
        </>
      )}
    </div>
  );
};

export default EnhancedPasswordResetForm;
