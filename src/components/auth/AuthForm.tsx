
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ClassicWindow } from "./ClassicWindow";
import { PhoneInput } from "./PhoneInput";
import { OtpInput } from "./OtpInput";
import { Separator } from "@/components/ui/separator";
import { SocialLoginButtons } from "./social-login/SocialLoginButtons";
import { AuthFooter } from "./AuthFooter";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PasswordResetForm } from "./password-reset/PasswordResetForm";
import { EmailLoginForm } from "./email-form/EmailLoginForm";

export const AuthForm = () => {
  const { isLoading, handlePhoneLogin, verifyOtp, handleSocialLogin, session } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isResetFlow, setIsResetFlow] = useState(false);

  // Debug logging to verify the component is rendering
  console.log("Rendering AuthForm component");

  // If the user is already logged in, redirect to dashboard
  useEffect(() => {
    if (session) {
      navigate('/dashboard');
    }
  }, [session, navigate]);

  useEffect(() => {
    const isReset = searchParams.get('reset') === 'true';
    setIsResetFlow(isReset);
    setShowForgotPassword(false);
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
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const success = await handlePhoneLogin(formattedPhone);
    setShowOtpInput(success);
  };

  const handleVerifyOtp = async () => {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    await verifyOtp(formattedPhone, otp);
  };

  const handleContinueWithoutLogin = () => {
    navigate('/dashboard');
  };

  if (isResetFlow) {
    return <PasswordResetForm />;
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 overflow-hidden bg-background">
      <div className="w-full max-w-[400px]">
        <ClassicWindow title="Welcome">
          <div className="space-y-6 max-h-[calc(100vh-8rem)] overflow-y-auto px-1 py-2">
            <EmailLoginForm
              isLoading={isLoading}
              showForgotPassword={showForgotPassword}
              setShowForgotPassword={setShowForgotPassword}
              isSignUp={isSignUp}
              setIsSignUp={setIsSignUp}
              onContinueWithoutLogin={handleContinueWithoutLogin}
            />

            {!showForgotPassword && (
              <>
                <Separator/>

                <SocialLoginButtons 
                  onSocialLogin={handleSocialLogin}
                  isLoading={isLoading}
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
