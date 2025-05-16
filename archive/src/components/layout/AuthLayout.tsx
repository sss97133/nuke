
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthState } from '@/hooks/auth/use-auth-state';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  const { session } = useAuthState();
  
  // If user is already authenticated, redirect to dashboard
  if (session) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
};
