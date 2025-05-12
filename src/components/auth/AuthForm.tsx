
import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { ClassicWindow } from "./ClassicWindow";
import { PhoneInput } from "./PhoneInput";
import { OtpInput } from "./OtpInput";
import { Separator } from "@/components/ui/separator";
import { SocialLoginButtons } from "./social-login/SocialLoginButtons";
import { AuthFooter } from "./AuthFooter";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { PasswordResetForm } from "./password-reset/PasswordResetForm";
import { EmailLoginForm } from "./email-form/EmailLoginForm";
import { Loader2, AlertTriangle, Info, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatAuthError, handleAuthError, isSchemaError } from "@/utils/supabase-helpers";
import { supabase } from "@/lib/supabase-client";
import { useUserStore } from "@/stores/userStore";

export const AuthForm = () => {
  // Get authentication state from our new auth provider
  const { session, isLoading, isAuthenticated } = useAuth();
  
  // Get user store methods
  const { getCurrentUser, signOut } = useUserStore();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [isResetFlow, setIsResetFlow] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Track if we're seeing database connectivity issues
  const [hasDbIssue, setHasDbIssue] = useState<boolean>(false);

  // Debug logging to verify the component is rendering
  console.log("Rendering AuthForm component", { session, isLoading, authError });

  // If the user is already logged in, redirect to dashboard
  useEffect(() => {
    if (session) {
      console.log("Session detected in AuthForm, redirecting to dashboard");
      navigate('/dashboard');
    }
  }, [session, navigate]);

  useEffect(() => {
    const isReset = searchParams.get('reset') === 'true';
    setIsResetFlow(isReset);
    setShowForgotPassword(false);
    
    // Clear any previous errors when changing forms
    setAuthError(null);
    setHasDbIssue(false);
    
    // Only perform Supabase health checks in development environment
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      const checkSupabaseHealth = async () => {
        try {
          const response = await fetch(`${import.meta.env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'}/auth/v1/health`);
          if (!response.ok) {
            console.error('Supabase health check failed:', response.status);
            setHasDbIssue(true);
          }
        } catch (error) {
          console.error('Supabase health check error:', error);
          setHasDbIssue(true);
        }
      };
      
      checkSupabaseHealth();
    }
  }, [searchParams]);

  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    if (phone.startsWith("+")) {
      return phone;
    }
    return `+${cleaned}`;
  };

  const handleSendOtp = async () => {
    try {
      setAuthError(null);
      const formattedPhone = formatPhoneNumber(phoneNumber);
      console.log("Sending OTP to", formattedPhone);
      
      // Use Supabase client directly to send OTP
      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone
      });
      
      if (error) {
        throw error;
      }
      
      setShowOtpInput(true);
    } catch (error: any) {
      console.error("Error sending OTP:", error);
      const errorMessage = handleAuthError(error);
      setAuthError(errorMessage);
      
      // Check if this is a schema/database issue
      if (isSchemaError(error)) {
        setHasDbIssue(true);
      }
    }
  };

  const handleVerifyOtp = async () => {
    try {
      setAuthError(null);
      const formattedPhone = formatPhoneNumber(phoneNumber);
      
      // Use Supabase client directly to verify OTP
      const { error, data } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp,
        type: 'sms'
      });
      
      if (error) {
        throw error;
      }
      
      // If successful, refresh the user data
      await getCurrentUser();
    } catch (error: any) {
      console.error("Error verifying OTP:", error);
      const errorMessage = handleAuthError(error);
      setAuthError(errorMessage);
      
      // Check if this is a schema/database issue
      if (isSchemaError(error)) {
        setHasDbIssue(true);
      }
    }
  };

  const handleContinueWithoutLogin = () => {
    navigate('/dashboard');
  };
  
  // Implement social login with direct Supabase authentication
  const handleSocialLogin = async (provider: any) => {
    try {
      setAuthError(null);
      
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      });
      
      if (error) {
        throw error;
      }
      
      // If successful but no redirect URL, something went wrong
      if (!data.url) {
        throw new Error('No redirect URL returned from OAuth provider');
      }
      
      // Redirect to the OAuth provider
      window.location.href = data.url;
    } catch (error: any) {
      handleSocialLoginError(error);
    }
  };

  const handleSocialLoginError = (error: any) => {
    console.error("Social login error:", error);
    const errorMessage = handleAuthError(error);
    setAuthError(errorMessage);
    
    // Check if this is a schema/database issue
    if (isSchemaError(error)) {
      setHasDbIssue(true);
    }
  };

  if (isResetFlow) {
    return <PasswordResetForm />;
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 overflow-hidden bg-background">
      <div className="w-full max-w-[400px]">
        <ClassicWindow title="Welcome">
          <div className="space-y-6 max-h-[calc(100vh-8rem)] overflow-y-auto px-1 py-2">
            {isLoading && (
              <div className="flex justify-center items-center py-4">
                <Loader2 className="animate-spin w-6 h-6 text-primary" />
                <span className="ml-2">Authenticating...</span>
              </div>
            )}
            
            {authError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Authentication Error</AlertTitle>
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            )}
            
            {/* Only show Supabase connection issues in development environment */}
            {hasDbIssue && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
              <Alert className="mb-4 bg-yellow-50 border border-yellow-200">
                <Info className="h-4 w-4" />
                <AlertTitle>Local Supabase Connection Issue Detected</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>There might be an issue with your local Supabase instance.</p>
                  <p className="text-sm">Common fixes:</p>
                  <ul className="text-sm pl-5 list-disc">
                    <li>Check if Supabase is running: <code className="bg-gray-100 px-1 py-0.5 rounded">docker ps | grep supabase</code></li>
                    <li>Check for port conflicts: <code className="bg-gray-100 px-1 py-0.5 rounded">lsof -i :54321-54324</code></li>
                    <li>Restart Supabase: <code className="bg-gray-100 px-1 py-0.5 rounded">supabase stop && supabase start</code></li>
                  </ul>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="mt-2 text-xs" 
                    onClick={() => window.open('http://localhost:54323', '_blank')}
                  >
                    Open Supabase Studio <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <EmailLoginForm
              isLoading={isLoading}
              showForgotPassword={showForgotPassword}
              setShowForgotPassword={setShowForgotPassword}
              isSignUp={isSignUp}
              setIsSignUp={setIsSignUp}
              onContinueWithoutLogin={handleContinueWithoutLogin}
              onError={(error) => setAuthError(error)}
            />

            {!showForgotPassword && (
              <>
                <Separator/>

                <SocialLoginButtons 
                  onSocialLogin={handleSocialLogin}
                  isLoading={isLoading}
                  onError={handleSocialLoginError}
                />

                <Separator/>

                <PhoneInput
                  phoneNumber={phoneNumber}
                  setPhoneNumber={setPhoneNumber}
                  onSubmit={handleSendOtp}
                  isLoading={isLoading}
                />

                {showOtpInput && (
                  <OtpInput
                    otp={otp}
                    setOtp={setOtp}
                    onSubmit={handleVerifyOtp}
                    isLoading={isLoading}
                  />
                )}
              </>
            )}

            <AuthFooter />
          </div>
        </ClassicWindow>
      </div>
    </div>
  );
};
