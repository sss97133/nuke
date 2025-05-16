import React from 'react';
import { ModernAuthLayout } from '@/components/auth/ModernAuthLayout';
import { ModernLoginForm } from '@/components/auth/ModernLoginForm';
import { useAuth } from '@/providers/AuthProvider';
import { Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const ModernLoginPage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  
  // If user is already authenticated, redirect to dashboard
  if (isAuthenticated && !isLoading) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return (
    <>
      <Helmet>
        <title>Sign In | Nuke Vehicle Identity Platform</title>
        <meta name="description" content="Access your vehicle's digital identity with secure authentication" />
      </Helmet>
      <ModernAuthLayout 
        title="Vehicle Identity Access"
        subtitle="Sign in to manage your vehicle's digital identity"
        className="vehicle-centric-auth"
      >
        <ModernLoginForm />
      </ModernAuthLayout>
    </>
  );
};

export default ModernLoginPage;
