import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase-client';
import { useAuth } from '@/providers/AuthProvider';
import { User } from '@supabase/supabase-js';
import UserAvatar from '@/components/auth/UserAvatar';
import { Card, CardHeader, CardContent, CardFooter, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Profile: React.FC = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  useEffect(() => {
    const getUser = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.auth.getUser();
        
        if (error) {
          throw error;
        }
        
        if (data?.user) {
          setUser(data.user);
          setEmail(data.user.email || '');
        }
      } catch (error) {
        console.error('Error fetching user:', error);
      } finally {
        setLoading(false);
      }
    };
    
    getUser();
  }, [session]);
  
  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      setError('Email is required');
      return;
    }
    
    try {
      setUpdating(true);
      setError(null);
      setSuccess(null);
      
      const { error } = await supabase.auth.updateUser({ email });
      
      if (error) {
        throw error;
      }
      
      setSuccess('Email update initiated. Please check your inbox for confirmation.');
    } catch (error) {
      console.error('Error updating email:', error);
      setError(error instanceof Error ? error.message : 'An error occurred while updating your email');
    } finally {
      setUpdating(false);
    }
  };
  
  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      navigate('/auth');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  return (
    <div className="flex justify-center min-h-screen p-4 bg-gray-50">
      <div className="w-full max-w-3xl pt-10">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Account Profile</CardTitle>
              <Button variant="outline" onClick={() => navigate('/dashboard')}>
                Back to Dashboard
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="profile" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              
              <TabsContent value="profile" className="space-y-6 pt-4">
                <div className="flex flex-col items-center sm:flex-row sm:items-start gap-6">
                  <div className="flex flex-col items-center">
                    <UserAvatar size="lg" />
                    <div className="mt-4 text-center">
                      <h3 className="text-lg font-medium">{user?.email}</h3>
                      <p className="text-sm text-gray-500">
                        ID: {user?.id.substring(0, 8)}...
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-4">
                    <div>
                      <h3 className="text-lg font-medium">Profile Information</h3>
                      <div className="mt-2 space-y-2">
                        <div>
                          <Label className="text-sm font-medium text-gray-500">Email</Label>
                          <p>{user?.email}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-500">Last Sign In</Label>
                          <p>{new Date(user?.last_sign_in_at || '').toLocaleString()}</p>
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-gray-500">Created At</Label>
                          <p>{new Date(user?.created_at || '').toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="settings" className="space-y-6 pt-4">
                {error && (
                  <Alert className="bg-red-50 border-red-200">
                    <AlertDescription className="text-red-600">{error}</AlertDescription>
                  </Alert>
                )}
                {success && (
                  <Alert className="bg-green-50 border-green-200">
                    <AlertDescription className="text-green-600">{success}</AlertDescription>
                  </Alert>
                )}
                
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium">Email Settings</h3>
                    <form onSubmit={handleUpdateEmail} className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address</Label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Enter your email address"
                          disabled={updating}
                        />
                      </div>
                      <Button type="submit" disabled={updating}>
                        {updating ? 'Updating...' : 'Update Email'}
                      </Button>
                    </form>
                  </div>
                  
                  <div className="pt-4">
                    <h3 className="text-lg font-medium">Password</h3>
                    <div className="mt-4">
                      <Button
                        variant="outline"
                        onClick={() => navigate('/auth/reset-password')}
                      >
                        Change Password
                      </Button>
                    </div>
                  </div>
                  
                  <div className="pt-4">
                    <h3 className="text-lg font-medium text-red-600">Danger Zone</h3>
                    <div className="mt-4">
                      <Button
                        variant="destructive"
                        onClick={handleSignOut}
                      >
                        Sign Out
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Profile;
