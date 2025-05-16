import React from 'react';
import { EnhancedAuthLayout } from '@/components/auth/EnhancedAuthLayout';
import { EnhancedSignInForm } from '@/components/auth/EnhancedSignInForm';
import { useAuth } from '@/providers/AuthProvider';
import { Navigate } from 'react-router-dom';

const EnhancedLoginPage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  
  // If user is already authenticated, redirect to dashboard
  if (isAuthenticated && !isLoading) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return (
    <EnhancedAuthLayout 
      title="The Complete Vehicle Management Platform"
      subtitle="Everything you need to manage your vehicle in one place."
    >
      <EnhancedSignInForm />
    </EnhancedAuthLayout>
  );
};

export default EnhancedLoginPage;
