import React from "react";
import { NewAuthLayout } from "@/components/auth/NewAuthLayout";
import { NewSignUpForm } from "@/components/auth/NewSignUpForm";

export function NewSignUpPage() {
  return (
    <NewAuthLayout
      title="Create an account"
      description="Sign up to get started with Nuke"
    >
      <NewSignUpForm />
    </NewAuthLayout>
  );
}

export default NewSignUpPage;
