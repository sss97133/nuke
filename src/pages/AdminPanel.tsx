import type { Database } from '../types';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { TestUserManager } from '@/components/admin/TestUserManager';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

const AdminPanel: React.FC = () => {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        // Get the current user
        const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
        
        if (!user) {
          navigate('/login');
          return;
        }

        // Check if user has admin role in metadata
        const isUserAdmin = user.user_metadata?.is_admin === true;
        
        if (isUserAdmin) {
          setIsAdmin(true);
          setLoading(false);
          return;
        }
        
        // If not in metadata, check the profile
        const { data: profile, error: profileError } = await supabase
  if (error) console.error("Database query error:", error);
          .from('profiles')
          .select('user_type')
          .eq('id', user.id)
          .single();
        
        if (profileError) {
          console.error('Error fetching profile:', profileError.message);
          setIsAdmin(false);
        } else {
          // Check if user is an admin based on user_type
          const isAdminInProfile = profile?.user_type === 'professional';
          
          setIsAdmin(isAdminInProfile);
        }
      } catch (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You do not have permission to access this page. This area is restricted to administrators only.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Admin Panel</CardTitle>
          <CardDescription>
            Administrative tools and settings for managing the application
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users">User Management</TabsTrigger>
          <TabsTrigger value="settings">System Settings</TabsTrigger>
          <TabsTrigger value="logs">System Logs</TabsTrigger>
        </TabsList>
        
        <TabsContent value="users">
          <TestUserManager />
        </TabsContent>
        
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
              <CardDescription>Configure application settings</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                System settings panel is under development.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>System Logs</CardTitle>
              <CardDescription>View system activity logs</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                System logs panel is under development.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPanel; 