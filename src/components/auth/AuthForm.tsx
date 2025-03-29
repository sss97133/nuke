
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ClassicWindow } from "./ClassicWindow";
import { PhoneInput } from "./PhoneInput";
import { OtpInput } from "./OtpInput";
import { Separator } from "@/components/ui/separator";
import { SocialLoginButtons } from "./social-login/SocialLoginButtons";
import { AuthFooter } from "./AuthFooter";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { PasswordResetForm } from "./password-reset/PasswordResetForm";
import { EmailLoginForm } from "./email-form/EmailLoginForm";
import { Loader2, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const AuthForm = () => {
  const { isLoading, handlePhoneLogin, verifyOtp, handleSocialLogin, session } = useAuth();
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
      const success = await handlePhoneLogin(formattedPhone);
      setShowOtpInput(success);
      if (!success) {
        setAuthError("Failed to send verification code. Please check your phone number and try again.");
      }
    } catch (error: any) {
      console.error("Error sending OTP:", error);
      setAuthError(error.message || "Failed to send verification code");
    }
  };

  const handleVerifyOtp = async () => {
    try {
      setAuthError(null);
      const formattedPhone = formatPhoneNumber(phoneNumber);
      console.log("Verifying OTP for", formattedPhone);
      await verifyOtp(formattedPhone, otp);
    } catch (error: any) {
      console.error("Error verifying OTP:", error);
      setAuthError(error.message || "Failed to verify code");
    }
  };

  const handleContinueWithoutLogin = () => {
    navigate('/dashboard');
  };

  const handleSocialLoginError = (error: any) => {
    console.error("Social login error:", error);
    setAuthError(error.message || "Social login failed");
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
