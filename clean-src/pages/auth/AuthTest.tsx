import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase-client';
import { useAuth } from '@/providers/AuthProvider';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UserAvatar from '@/components/auth/UserAvatar';
import SignOut from '@/components/auth/SignOut';

const AuthTest: React.FC = () => {
  const { session, isAuthenticated, isLoading } = useAuth();
  const [authProviders, setAuthProviders] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Check available auth providers from Supabase
    const checkAuthProviders = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        console.log('Current session:', data?.session);
        
        if (error) {
          console.error('Error checking session:', error);
        }
      } catch (error) {
        console.error('Error fetching auth providers:', error);
      }
    };

    checkAuthProviders();
  }, []);

  return (
    <div className="container mx-auto py-10">
      <Card className="max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl">Authentication Test Page</CardTitle>
          <CardDescription>
            Testing the Supabase UI authentication system
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <Tabs defaultValue="status" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="status">Auth Status</TabsTrigger>
              <TabsTrigger value="session">Session Data</TabsTrigger>
              <TabsTrigger value="actions">Auth Actions</TabsTrigger>
            </TabsList>
            
            <TabsContent value="status" className="space-y-4 py-4">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Current Status</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-md bg-gray-100">
                    <p className="text-sm font-medium text-gray-500">Loading</p>
                    <p className="font-medium">{isLoading ? 'Yes' : 'No'}</p>
                  </div>
                  <div className="p-3 rounded-md bg-gray-100">
                    <p className="text-sm font-medium text-gray-500">Authenticated</p>
                    <p className="font-medium">{isAuthenticated ? 'Yes' : 'No'}</p>
                  </div>
                  <div className="p-3 rounded-md bg-gray-100">
                    <p className="text-sm font-medium text-gray-500">Session</p>
                    <p className="font-medium">{session ? 'Active' : 'None'}</p>
                  </div>
                  <div className="p-3 rounded-md bg-gray-100">
                    <p className="text-sm font-medium text-gray-500">User Avatar</p>
                    <UserAvatar />
                  </div>
                </div>
              </div>
              
              {isAuthenticated && (
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">User Info</h3>
                  <div className="p-4 rounded-md bg-gray-100 space-y-1">
                    <p><span className="font-medium">ID:</span> {session?.user.id}</p>
                    <p><span className="font-medium">Email:</span> {session?.user.email}</p>
                    <p><span className="font-medium">Last Sign In:</span> {session?.user.last_sign_in_at ? new Date(session.user.last_sign_in_at).toLocaleString() : 'N/A'}</p>
                  </div>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="session" className="py-4">
              {isAuthenticated ? (
                <div className="space-y-2">
                  <h3 className="text-lg font-medium">Session Data</h3>
                  <pre className="p-4 bg-gray-100 rounded-md overflow-auto text-xs max-h-[300px]">
                    {JSON.stringify(session, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500">
                  <p>Not authenticated. Sign in to view session data.</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="actions" className="space-y-4 py-4">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Authentication Actions</h3>
                
                <div className="grid grid-cols-2 gap-2">
                  {!isAuthenticated ? (
                    <>
                      <Button
                        variant="default"
                        onClick={() => navigate('/auth')}
                        className="w-full"
                      >
                        Sign In
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate('/auth')}
                        className="w-full"
                      >
                        Sign Up
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="default"
                        onClick={() => navigate('/auth/profile')}
                        className="w-full"
                      >
                        View Profile
                      </Button>
                      <SignOut
                        variant="destructive"
                        className="w-full"
                      />
                    </>
                  )}
                </div>
              </div>
              
              <div className="pt-2 border-t">
                <h3 className="text-lg font-medium">Auth Navigation</h3>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Button
                    variant="outline"
                    onClick={() => navigate('/auth')}
                    className="w-full"
                  >
                    Auth Home
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate('/auth/reset-password')}
                    className="w-full"
                  >
                    Reset Password
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
        
        <CardFooter className="border-t pt-4 flex justify-between">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go Back
          </Button>
          <Button onClick={() => navigate('/dashboard')}>
            Dashboard
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default AuthTest;
