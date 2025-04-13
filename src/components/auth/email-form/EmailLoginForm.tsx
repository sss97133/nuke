import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useEmailForm } from "./useEmailForm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { z } from "zod";

interface EmailLoginFormProps {
  isLoading: boolean;
  showForgotPassword: boolean;
  setShowForgotPassword: (show: boolean) => void;
  isSignUp: boolean;
  setIsSignUp: (isSignup: boolean) => void;
  onContinueWithoutLogin: () => void;
  onError?: (error: string) => void;
}

export const EmailLoginForm = React.memo(({
  isLoading,
  showForgotPassword,
  setShowForgotPassword,
  isSignUp,
  setIsSignUp,
  onContinueWithoutLogin,
  onError
}: EmailLoginFormProps) => {
  const {
    email,
    setEmail,
    password,
    setPassword,
    rememberMe,
    setRememberMe,
    avatarUrl,
    setAvatarUrl,
    handleSubmit,
    formError,
    isSubmitting
  } = useEmailForm(showForgotPassword, isSignUp, onError);

  // Debug logging only in development and only on mount
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log("EmailLoginForm mounted", { 
        showForgotPassword, 
        isSignUp, 
        hasError: !!formError 
      });
    }
  }, []);

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-submitting={isSubmitting ? "true" : "false"}>
      {formError && (
        <Alert variant="destructive" className="py-2">
          <ExclamationTriangleIcon className="h-4 w-4 mr-2" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      
      {/* Show loading indicator */}
      {isSubmitting && (
        <div className="flex items-center justify-center p-2 bg-blue-50 text-blue-700 rounded-md">
          <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Processing...</span>
        </div>
      )}
      
      <div className="space-y-2">
        <Input
          id="email"
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="classic-input"
          disabled={isLoading}
        />
      </div>
      
      {!showForgotPassword && (
        <div className="space-y-2">
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="classic-input"
            disabled={isLoading}
          />
        </div>
      )}
      
      {isSignUp && (
        <div className="space-y-2">
          <Input
            id="avatarUrl"
            type="url"
            placeholder="Avatar URL (optional)"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            className="classic-input"
            disabled={isLoading}
          />
        </div>
      )}
      
      {!showForgotPassword && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked as boolean)}
              disabled={isLoading}
            />
            <Label htmlFor="remember" className="text-sm">Remember me</Label>
          </div>
        </div>
      )}
      
      <Button 
        type="submit" 
        className="classic-button w-full font-system bg-secondary hover:bg-accent hover:text-accent-foreground" 
        disabled={isLoading || isSubmitting}
      >
        {isSubmitting 
          ? <span className="flex items-center justify-center">
              <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {showForgotPassword ? 'Sending...' : (isSignUp ? 'Creating Account...' : 'Logging In...')}
            </span>
          : (showForgotPassword ? 'Send Reset Link' : (isSignUp ? 'Sign Up' : 'Login'))
        }
      </Button>
      
      <Button 
        type="button" 
        variant="outline" 
        className="classic-button w-full border border-border bg-transparent hover:bg-accent/50" 
        onClick={onContinueWithoutLogin}
        disabled={isLoading}
      >
        Continue without logging in
      </Button>

      {showForgotPassword ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowForgotPassword(false)}
            className="text-primary hover:underline font-system"
            disabled={isLoading}
          >
            Back to login
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center space-x-4 py-2">
          <button
            type="button"
            onClick={() => setShowForgotPassword(true)}
            className="text-primary hover:underline font-system px-2"
            disabled={isLoading}
          >
            Forgot password?
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-primary hover:underline font-system px-2"
            disabled={isLoading}
          >
            {isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign Up"}
          </button>
        </div>
      )}
    </form>
  );
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return prevProps.isLoading === nextProps.isLoading && 
         prevProps.showForgotPassword === nextProps.showForgotPassword &&
         prevProps.isSignUp === nextProps.isSignUp;
});
