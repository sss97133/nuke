import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Trash2, UserPlus, RefreshCw } from 'lucide-react';

interface TestUser {
  id: string;
  email: string | null;
  created_at: string;
  username?: string | null;
  full_name?: string | null;
  is_admin?: boolean;
}

export const TestUserManager: React.FC = () => {
  const [users, setUsers] = useState<TestUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const { toast } = useToast();

  // Fetch all users
  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Try to get users from auth.users view (requires admin access)
      try {
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
        
        if (!authError && authUsers) {
          // Map auth users to our format
          const formattedUsers = authUsers.users.map(user => ({
            id: user.id,
            email: user.email || null,
            created_at: user.created_at,
            username: user.user_metadata?.username || null,
            full_name: user.user_metadata?.full_name || null,
            is_admin: user.user_metadata?.is_admin || false
          }));
          setUsers(formattedUsers);
          return;
        }
      } catch (adminError) {
        console.log('Admin API not available, falling back to profiles table');
      }
      
      // Fallback to profiles table
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, created_at, username, full_name')
        .order('created_at', { ascending: false });
        
      if (profilesError) throw profilesError;
      setUsers(profiles || []);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error('Failed to fetch users');
      console.error('Error fetching users:', error.message);
      toast({
        title: 'Error fetching users',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Create a new test user
  const createUser = async () => {
    if (!email || !password) {
      toast({
        title: 'Missing fields',
        description: 'Email and password are required',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Create user with Supabase Auth using service role
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto-confirm the email
        user_metadata: {
          full_name: fullName || 'Test User',
          username: username || email.split('@')[0],
          is_admin: isAdmin,
        }
      });

      if (error) {
        console.error('Auth signup error:', error);
        throw new Error(`Failed to create user: ${error.message}`);
      }

      if (!data?.user) {
        throw new Error('No user data returned from signup');
      }

      // Create profile using service role
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          email: data.user.email,
          full_name: fullName || 'Test User',
          username: username || email.split('@')[0],
          user_type: isAdmin ? 'professional' : 'viewer',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        throw new Error(`Failed to create profile: ${profileError.message}`);
      }

      toast({
        title: 'User created successfully',
        description: `Created user: ${email}. You can now log in with this account.`,
        variant: 'success',
      });

      // Clear form
      setEmail('');
      setPassword('');
      setFullName('');
      setUsername('');
      setIsAdmin(false);

      // Refresh user list
      fetchUsers();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error('Failed to create user');
      console.error('Error creating user:', error);
      toast({
        title: 'Error creating user',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Delete a user
  const deleteUser = async (userId: string, userEmail: string) => {
    if (!confirm(`Are you sure you want to delete user ${userEmail}?`)) {
      return;
    }

    setLoading(true);
    try {
      let authDeleted = false;
      
      // Try to delete user with admin API
      try {
        const { error: adminError } = await supabase.auth.admin.deleteUser(userId);
        if (!adminError) {
          authDeleted = true;
          console.log('User deleted from auth successfully');
        } else {
          console.error('Admin delete failed:', adminError.message);
        }
      } catch (adminErr: unknown) {
        const adminError = adminErr instanceof Error ? adminErr : new Error('Admin API error');
        console.error('Admin API not available:', adminError.message);
      }
      
      // Always try to delete from profiles table
      try {
        const { error: profileError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', userId);

        if (profileError) {
          console.error('Profile delete failed:', profileError.message);
          // Only throw if auth delete also failed
          if (!authDeleted) {
            throw profileError;
          }
        }
      } catch (profileErr: unknown) {
        const profileError = profileErr instanceof Error ? profileErr : new Error('Profile delete error');
        console.error('Profile delete error:', profileError.message);
        // Only throw if auth delete also failed
        if (!authDeleted) {
          throw profileError;
        }
      }

      toast({
        title: 'User deleted',
        description: `Successfully deleted user: ${userEmail}`,
        variant: 'success',
      });

      // Refresh user list
      fetchUsers();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error('Failed to delete user');
      console.error('Error deleting user:', error.message);
      toast({
        title: 'Error deleting user',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Load users on component mount
  useEffect(() => {
    fetchUsers();
  }, []);

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Test User Manager</CardTitle>
          <CardDescription>Create and manage test users for your application</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="test@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Password123!"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  placeholder="Test User"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="testuser"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isAdmin"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="isAdmin">Admin User</Label>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={fetchUsers} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button onClick={createUser} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
            Create User
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test Users</CardTitle>
          <CardDescription>Manage existing test users</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground">No users found</p>
          ) : (
            <div className="space-y-4">
              {users.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">{user.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {user.full_name || 'No name'} ({user.username || 'No username'})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created: {new Date(user.created_at).toLocaleString()}
                    </p>
                    {user.is_admin && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Admin
                      </span>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteUser(user.id, user.email || '')}
                    disabled={loading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}; 