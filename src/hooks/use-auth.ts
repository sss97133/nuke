
import { useAuthState } from "./auth/use-auth-state";
import { useAuthActions } from "./auth/use-auth-actions";
import { useSocialAuth } from "./use-social-auth";
import { usePhoneAuth } from "./use-phone-auth";
import { useEmailAuth } from "./use-email-auth";

export const useAuth = () => {
  const { loading: stateLoading, session } = useAuthState();
  const { handleSocialLogin, handleLogout } = useAuthActions();
  const { isLoading: isSocialLoading, handleSocialLogin: socialLogin } = useSocialAuth();
  const { 
    handlePhoneLogin: phoneLogin, 
    verifyOtp: verifyPhoneOtp,
    isLoading: isPhoneLoading 
  } = usePhoneAuth();
  const {
    handleEmailLogin: emailLogin,
    handleForgotPassword,
    isLoading: isEmailLoading
  } = useEmailAuth();

  return {
    isLoading: stateLoading || isSocialLoading || isPhoneLoading || isEmailLoading,
    session,
    handleSocialLogin,
    handleLogout,
    handlePhoneLogin: phoneLogin,
    verifyOtp: verifyPhoneOtp,
    handleEmailLogin: emailLogin,
    handleForgotPassword
  };
};
