
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ClassicWindow } from "./ClassicWindow";
import { PhoneInput } from "./PhoneInput";
import { OtpInput } from "./OtpInput";
import { Separator } from "@/components/ui/separator";
import { SocialLoginButtons } from "./SocialLoginButtons";
import { AuthFooter } from "./AuthFooter";

export const AuthForm = () => {
  const { isLoading, handleSocialLogin, handleLogout, handlePhoneLogin, verifyOtp } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);

  const formatPhoneNumber = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    if (phone.startsWith("+")) {
      return cleaned;
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

  return (
    <div className="w-full max-w-[400px]">
      <ClassicWindow title="Welcome">
        <div className="space-y-6">
          <SocialLoginButtons 
            onSocialLogin={handleSocialLogin}
            isLoading={isLoading}
          />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with phone
              </span>
            </div>
          </div>

          {!showOtpInput ? (
            <PhoneInput
              phoneNumber={phoneNumber}
              setPhoneNumber={setPhoneNumber}
              onSubmit={handleSendOtp}
              isLoading={isLoading}
            />
          ) : (
            <OtpInput
              otp={otp}
              setOtp={setOtp}
              onSubmit={handleVerifyOtp}
              isLoading={isLoading}
            />
          )}

          <AuthFooter 
            onLogout={handleLogout}
            isLoading={isLoading}
          />
        </div>
      </ClassicWindow>
    </div>
  );
};
