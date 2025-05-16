import React from 'react';
import { useNavigate } from 'react-router-dom';
import AuthUI from '@/components/auth/AuthUI';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useVehicle } from '@/providers/VehicleProvider';
import { Loader } from 'lucide-react';

const Auth: React.FC = () => {
  const navigate = useNavigate();
  const { loading, user } = useVehicle();
  
  // If user is already authenticated, redirect to dashboard
  React.useEffect(() => {
    if (user && !loading) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Loading</CardTitle>
            <CardDescription>Checking authentication status...</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <Loader className="h-8 w-8 animate-spin" />
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-gray-50">
      <div className="w-full max-w-md">
        <AuthUI redirectTo="/dashboard" />
      </div>
    </div>
  );
};

export default Auth;
