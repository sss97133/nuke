import React from "react";
import { NewAuthLayout } from "@/components/auth/NewAuthLayout";
import { PasswordResetForm } from "@/components/auth/PasswordResetForm";

export function NewResetPasswordPage() {
  return (
    <NewAuthLayout
      title="Reset Password"
      description="Enter your email to reset your password"
    >
      <PasswordResetForm />
    </NewAuthLayout>
  );
}

export default NewResetPasswordPage;
