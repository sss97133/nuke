
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export const useEmailForm = (showForgotPassword: boolean, isSignUp: boolean) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const { handleEmailLogin, handleForgotPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (showForgotPassword) {
      await handleForgotPassword(email);
      return;
    }
    await handleEmailLogin(email, password, isSignUp, avatarUrl);
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    rememberMe,
    setRememberMe,
    avatarUrl,
    setAvatarUrl,
    handleSubmit
  };
};
