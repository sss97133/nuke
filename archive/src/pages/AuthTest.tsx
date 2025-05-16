import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/providers/AuthProvider';
import { useUserStore } from '@/stores/userStore';
import { supabase } from '@/lib/supabase-client';
import { UserProfileView } from '@/components/profile/UserProfileView';
import { Helmet } from 'react-helmet-async';
import { AlertCircle, Check, X, RefreshCw, Shield } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

/**
 * AuthTest Page
 * 
 * This page provides a comprehensive view of the authentication system with:
 * - Current authentication state
 * - User profile information
 * - Supabase connection status
 * - Navigation to key auth-related pages
 */
export const AuthTest: React.FC = () => {
  const navigate = useNavigate();
  const { session, isLoading, isAuthenticated } = useAuth();
  const { user, getCurrentUser } = useUserStore();
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [supabaseError, setSupabaseError] = useState<string | null>(null);

  // Check Supabase connection
  useEffect(() => {
    const checkSupabaseConnection = async () => {
      try {
        setSupabaseStatus('checking');
        
        // Try to ping the Supabase health endpoint
        const { data: authData, error: authError } = await supabase.auth.getSession();
        if (authError) throw authError;
        
        // Try to query a table to verify database connection
        const { error: queryError } = await supabase
          .from('profiles')
          .select('id')
          .limit(1);
        
        if (queryError) throw queryError;
        
        setSupabaseStatus('connected');
        setSupabaseError(null);
      } catch (error: any) {
        console.error('Supabase connection error:', error);
        setSupabaseStatus('error');
        setSupabaseError(error.message || 'Failed to connect to Supabase');
      }
    };
    
    checkSupabaseConnection();
  }, []);

  // Force refresh user data
  const handleRefreshUserData = async () => {
    await getCurrentUser();
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <Helmet>
        <title>Authentication Test | Nuke</title>
      </Helmet>

      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-bold">Authentication System Test</h1>
        <p className="text-muted-foreground">
          This page helps verify that the authentication system is working correctly
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Authentication Status
            </CardTitle>
            <CardDescription>
              Current state of your authentication session
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">Authentication State:</span>
                <span className="flex items-center gap-2">
                  {isLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-yellow-500" />
                  ) : isAuthenticated ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-red-500" />
                  )}
                  {isLoading ? 'Loading...' : isAuthenticated ? 'Authenticated' : 'Not Authenticated'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="font-medium">Session Valid:</span>
                <span className="flex items-center gap-2">
                  {isLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-yellow-500" />
                  ) : session ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-red-500" />
                  )}
                  {isLoading ? 'Loading...' : session ? 'Valid Session' : 'No Session'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="font-medium">User Data:</span>
                <span className="flex items-center gap-2">
                  {isLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-yellow-500" />
                  ) : user ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-red-500" />
                  )}
                  {isLoading ? 'Loading...' : user ? 'Available' : 'Not Available'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className="font-medium">Supabase Connection:</span>
                <span className="flex items-center gap-2">
                  {supabaseStatus === 'checking' ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-yellow-500" />
                  ) : supabaseStatus === 'connected' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <X className="h-4 w-4 text-red-500" />
                  )}
                  {supabaseStatus === 'checking' 
                    ? 'Checking...' 
                    : supabaseStatus === 'connected' 
                      ? 'Connected' 
                      : 'Connection Error'}
                </span>
              </div>
            </div>

            {supabaseStatus === 'error' && supabaseError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Supabase Connection Error</AlertTitle>
                <AlertDescription>{supabaseError}</AlertDescription>
              </Alert>
            )}

            <div className="pt-4">
              <Button 
                onClick={handleRefreshUserData} 
                variant="outline" 
                size="sm" 
                className="w-full"
                disabled={isLoading}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh User Data
              </Button>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button 
                onClick={() => navigate('/auth')} 
                variant={isAuthenticated ? 'outline' : 'default'}
              >
                {isAuthenticated ? 'Re-authenticate' : 'Sign In'}
              </Button>
              
              <Button 
                onClick={() => navigate('/dashboard')} 
                variant="outline"
              >
                Dashboard
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button 
                onClick={() => navigate('/profile')} 
                variant="outline"
              >
                Profile
              </Button>
              
              <Button 
                onClick={() => navigate('/add-vehicle')} 
                variant="outline"
              >
                Add Vehicle
              </Button>
            </div>
          </CardFooter>
        </Card>
        
        <div className="space-y-6">
          <UserProfileView />
          
          <Card>
            <CardHeader>
              <CardTitle>Vehicle Data Access Test</CardTitle>
              <CardDescription>
                Test protected data access functionality
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The buttons below test database access for the current user.
                  They should only work when you're properly authenticated.
                </p>
                
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    onClick={() => navigate('/vehicles')} 
                    variant="outline"
                  >
                    View Vehicles
                  </Button>
                  
                  <Button 
                    onClick={() => navigate('/add-vehicle')} 
                  >
                    Add New Vehicle
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

// Wrap the component in a ProtectedRoute for security
const ProtectedAuthTest: React.FC = () => (
  <ProtectedRoute>
    <AuthTest />
  </ProtectedRoute>
);

export default ProtectedAuthTest;
