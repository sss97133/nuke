
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ClassicWindow } from "./ClassicWindow";
import { PhoneInput } from "./PhoneInput";
import { OtpInput } from "./OtpInput";
import { Separator } from "@/components/ui/separator";
import { SocialLoginButtons } from "./SocialLoginButtons";
import { AuthFooter } from "./AuthFooter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export const AuthForm = () => {
  const { isLoading, handleSocialLogin, handlePhoneLogin, verifyOtp, handleEmailLogin, handleForgotPassword } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetFlow, setIsResetFlow] = useState(false);

  useEffect(() => {
    // Check if we're in the reset password flow
    const isReset = searchParams.get('reset') === 'true';
    setIsResetFlow(isReset);
    setShowForgotPassword(false); // Reset the forgot password view if we're in reset flow
  }, [searchParams]);

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

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      return;
    }
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      // Redirect to login
      navigate('/login');
    } catch (error) {
      console.error('Error updating password:', error);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showForgotPassword) {
      await handleForgotPassword(email);
      return;
    }
    await handleEmailLogin(email, password, isSignUp);
  };

  const handleContinueWithoutLogin = () => {
    navigate('/');
  };

  if (isResetFlow) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-4">
        <div className="w-full max-w-[400px]">
          <ClassicWindow title="Reset Password">
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading || newPassword !== confirmPassword}>
                Update Password
              </Button>
            </form>
          </ClassicWindow>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <ClassicWindow title="Welcome">
          <div className="space-y-6">
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-2">
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
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
                    />
                    <Label htmlFor="remember" className="text-sm">Remember me</Label>
                  </div>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {showForgotPassword ? 'Send Reset Link' : (isSignUp ? 'Sign Up' : 'Login')}
              </Button>
              
              <Button 
                type="button" 
                variant="outline" 
                className="w-full" 
                onClick={handleContinueWithoutLogin}
              >
                Continue without logging in
              </Button>

              {showForgotPassword ? (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(false)}
                    className="text-blue-500 hover:underline"
                  >
                    Back to login
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center space-x-4 py-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text-blue-500 hover:underline px-2"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSignUp(!isSignUp)}
                    className="text-blue-500 hover:underline px-2"
                  >
                    {isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign Up"}
                  </button>
                </div>
              )}
            </form>

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
