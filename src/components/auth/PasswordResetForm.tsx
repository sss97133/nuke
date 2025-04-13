import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function PasswordResetForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const navigate = useNavigate();

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      setError("Please enter your email address");
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      const { data, error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
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

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {isSuccess ? (
        <div className="space-y-6">
          <Alert variant="default" className="border-green-500 bg-green-50">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <AlertDescription className="text-green-700">
              Password reset email sent! Check your inbox for instructions.
            </AlertDescription>
          </Alert>
          
          <div className="text-center text-sm text-muted-foreground">
            Didn't receive an email? Check your spam folder or{" "}
            <button
              type="button"
              onClick={() => setIsSuccess(false)}
              className="text-primary hover:underline"
            >
              try again
            </button>
          </div>
          
          <Button 
            type="button" 
            variant="outline" 
            className="w-full"
            onClick={() => navigate('/login')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Sign In
          </Button>
        </div>
      ) : (
        <>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-medium">Reset your password</h3>
            <p className="text-sm text-muted-foreground">
              Enter the email address associated with your account and we'll send you a link to reset your password.
            </p>
          </div>
          
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send reset email
            </Button>
            
            <Button 
              type="button" 
              variant="ghost" 
              className="w-full"
              onClick={() => navigate('/login')}
            >
              Back to Sign In
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

export default PasswordResetForm;
