import React from 'react';
import { ModernAuthLayout } from '@/components/auth/ModernAuthLayout';
import { ModernLoginForm } from '@/components/auth/ModernLoginForm';
import { useAuth } from '@/providers/AuthProvider';
import { Navigate } from 'react-router-dom';

const ModernLoginPage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  
  // If user is already authenticated, redirect to dashboard
  if (isAuthenticated && !isLoading) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return (
    <ModernAuthLayout 
      title="Welcome back"
      subtitle="Sign in to your account to continue"
    >
      <ModernLoginForm />
    </ModernAuthLayout>
  );
};

export default ModernLoginPage;
