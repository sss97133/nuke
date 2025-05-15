import React from "react";
import { EnhancedAuthLayout } from "@/components/auth/EnhancedAuthLayout";
import { PasswordResetForm } from "@/components/auth/PasswordResetForm";
import { useUserStore } from "@/stores/userStore";
import { Navigate } from "react-router-dom";

export function EnhancedResetPasswordPage() {
  const { isAuthenticated } = useUserStore();

  // Redirect authenticated users to dashboard
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <EnhancedAuthLayout
      title="Reset Password"
      subtitle="Securely reset your password and regain access to your account"
    >
      <PasswordResetForm />
    </EnhancedAuthLayout>
  );
}

export default EnhancedResetPasswordPage;
