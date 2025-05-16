import React from "react";
import { NewAuthLayout } from "@/components/auth/NewAuthLayout";
import { NewSignInForm } from "@/components/auth/NewSignInForm";

export function NewLoginPage() {
  return (
    <NewAuthLayout
      title="Welcome back"
      description="Sign in to your account to continue"
    >
      <NewSignInForm />
    </NewAuthLayout>
  );
}

export default NewLoginPage;
