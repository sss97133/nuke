import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function TestSupabase() {
  const [testMessage, setTestMessage] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  
  // Auth state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Test reading from Supabase on component load and set up auth listener
  useEffect(() => {
    // Check current auth state
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setCurrentUser(data.session.user);
        setResults(prev => [...prev, `User is authenticated: ${data.session.user.email}`]);
      }
    });

    // Set up auth listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session);
      if (session) {
        setCurrentUser(session.user);
        setResults(prev => [...prev, `Auth changed: ${event} - User: ${session.user.email}`]);
      } else {
        setCurrentUser(null);
        setResults(prev => [...prev, `Auth changed: ${event} - No user`]);
      }
    });
    
    async function testConnection() {
      try {
        setResults(prev => [...prev, "Testing Supabase connection..."]);
        
        // Get Supabase URL and key from environment
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        
        setResults(prev => [...prev, `URL: ${supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'Not found'}`]);
        setResults(prev => [...prev, `Key defined: ${!!supabaseKey}`]);
        
        // Test authentication state
        const { data: { session } } = await supabase.auth.getSession();
        setResults(prev => [...prev, `Session exists: ${!!session}`]);
        
        if (session) {
          setResults(prev => [...prev, `User is authenticated: ${session.user.email}`]);
        } else {
          setResults(prev => [...prev, "No active session - testing public access"]);
        }
        
        // Simple read test - try a table that should exist
        try {
          const { data: testData, error: readError } = await supabase
            .from('profiles')
            .select('count')
            .limit(1);
          
          if (readError) {
            setResults(prev => [...prev, `READ ERROR on profiles: ${readError.message}`]);
            
            // Try another table as fallback
            const { data: vehicles, error: vehicleError } = await supabase
              .from('vehicles')
              .select('count')
              .limit(1);
              
            if (vehicleError) {
              setResults(prev => [...prev, `READ ERROR on vehicles: ${vehicleError.message}`]);
            } else {
              setResults(prev => [...prev, `Successfully connected to database!`]);
            }
          } else {
            setResults(prev => [...prev, `Successfully connected to database!`]);
          }
        } catch (dbError) {
          setResults(prev => [...prev, `Database error: ${dbError instanceof Error ? dbError.message : String(dbError)}`]);
        }
      } catch (e) {
        setResults(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`]);
      }
    }
    
    testConnection();
    
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Test writing to Supabase when button is clicked
  const testDataSaving = async () => {
    if (!testMessage.trim()) {
      setResults(prev => [...prev, "Please enter a test message first"]);
      return;
    }
    
    setIsLoading(true);
    try {
      setResults(prev => [...prev, `Testing data saving with message: "${testMessage}"`]);
      
      // Try to write to the logs table (should be publicly writable for testing)
      const testRecord = {
        message: testMessage,
        timestamp: new Date().toISOString(),
        user_agent: navigator.userAgent,
        environment: import.meta.env.MODE || 'unknown'
      };
      
      const { data: insertResult, error: insertError } = await supabase
        .from('test_logs')
        .insert(testRecord)
        .select();
      
      if (insertError) {
        setResults(prev => [...prev, `WRITE ERROR: ${insertError.message} (${insertError.code})`]);
        
        // If table doesn't exist, try a different one
        if (insertError.code === '42P01') {
          setResults(prev => [...prev, "Trying 'logs' table instead..."]);
          
          const { data: logsResult, error: logsError } = await supabase
            .from('logs')
            .insert(testRecord)
            .select();
            
          if (logsError) {
            setResults(prev => [...prev, `LOGS WRITE ERROR: ${logsError.message}`]);
          } else {
            setResults(prev => [...prev, "✅ Successfully wrote test message to logs table!"]);
          }
        }
      } else {
        setResults(prev => [...prev, "✅ Successfully saved test message to database!"]);
      }
    } catch (e) {
      setResults(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle sign in
  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      setAuthMessage('Please enter both email and password');
      return;
    }
    
    setAuthLoading(true);
    setAuthMessage('');
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (error) {
        console.error('Sign in error:', error);
        setAuthMessage(`Error: ${error.message}`);
      } else if (data?.user) {
        setAuthMessage('Signed in successfully!');
        setCurrentUser(data.user);
      }
    } catch (err) {
      console.error('Unexpected auth error:', err);
      setAuthMessage(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle sign up
  const handleSignUp = async () => {
    if (!email.trim() || !password.trim()) {
      setAuthMessage('Please enter both email and password');
      return;
    }
    
    setAuthLoading(true);
    setAuthMessage('');
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });
      
      if (error) {
        console.error('Sign up error:', error);
        setAuthMessage(`Error: ${error.message}`);
      } else {
        setAuthMessage('Check your email for the confirmation link');
        // Create a profile record if needed
        if (data?.user) {
          try {
            const { error: profileError } = await supabase
              .from('profiles')
              .insert([{ 
                id: data.user.id,
                email: email,
                created_at: new Date().toISOString()
              }]);
              
            if (profileError) {
              console.warn('Profile creation error:', profileError);
            }
          } catch (profileErr) {
            console.warn('Profile creation failed:', profileErr);
          }
        }
      }
    } catch (err) {
      console.error('Unexpected auth error:', err);
      setAuthMessage(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle password reset
  const handlePasswordReset = async () => {
    if (!email.trim()) {
      setAuthMessage('Please enter your email');
      return;
    }
    
    setAuthLoading(true);
    setAuthMessage('');
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`
      });
      
      if (error) {
        console.error('Password reset error:', error);
        setAuthMessage(`Error: ${error.message}`);
      } else {
        setAuthMessage('Check your email for the password reset link');
      }
    } catch (err) {
      console.error('Unexpected auth error:', err);
      setAuthMessage(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle sign out
  const handleSignOut = async () => {
    setAuthLoading(true);
    
    try {
      const { error } = await supabase.auth.signOut();
      
      if (error) {
        console.error('Sign out error:', error);
        setAuthMessage(`Error: ${error.message}`);
      } else {
        setCurrentUser(null);
        setAuthMessage('Signed out successfully');
      }
    } catch (err) {
      console.error('Unexpected auth error:', err);
      setAuthMessage(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Supabase Authentication Test</h1>
      
      <div className="mb-6">
        <Alert>
          <AlertTitle>Connection Status</AlertTitle>
          <AlertDescription>
            {results.length > 0 ? (
              <div>
                {/* Show just the first few results related to connection */}
                {results.slice(0, 5).map((result, i) => (
                  <div key={i} className="text-sm">{result}</div>
                ))}
              </div>
            ) : (
              "Testing connection..."
            )}
          </AlertDescription>
        </Alert>
      </div>
      
      <Tabs defaultValue="auth" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="auth">Authentication</TabsTrigger>
          <TabsTrigger value="database">Database Test</TabsTrigger>
          <TabsTrigger value="logs">Connection Logs</TabsTrigger>
        </TabsList>
        
        <TabsContent value="auth" className="space-y-4 mt-4">
          {currentUser ? (
            <Card>
              <CardHeader>
                <CardTitle>Currently Signed In</CardTitle>
                <CardDescription>You are signed in with the following account</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div><strong>Email:</strong> {currentUser.email}</div>
                  <div><strong>User ID:</strong> {currentUser.id}</div>
                  <div><strong>Last Sign In:</strong> {new Date(currentUser.last_sign_in_at || Date.now()).toLocaleString()}</div>
                </div>
              </CardContent>
              <CardFooter>
                <Button onClick={handleSignOut} disabled={authLoading} variant="destructive" className="w-full">
                  {authLoading ? 'Processing...' : 'Sign Out'}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Authentication</CardTitle>
                <CardDescription>Sign in or create an account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {authMessage && (
                  <div className={`p-2 text-sm rounded ${authMessage.includes('Error') ? 'bg-red-100' : 'bg-green-100'}`}>
                    {authMessage}
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your.email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-2">
                <div className="grid grid-cols-2 gap-2 w-full">
                  <Button 
                    onClick={handleSignIn} 
                    disabled={authLoading || !email.trim() || !password.trim()}
                    className="w-full"
                  >
                    {authLoading ? 'Processing...' : 'Sign In'}
                  </Button>
                  
                  <Button 
                    onClick={handleSignUp}
                    disabled={authLoading || !email.trim() || !password.trim()}
                    variant="outline"
                    className="w-full"
                  >
                    {authLoading ? 'Processing...' : 'Sign Up'}
                  </Button>
                </div>
                
                <Button 
                  onClick={handlePasswordReset}
                  disabled={authLoading || !email.trim()}
                  variant="ghost"
                  className="w-full"
                >
                  {authLoading ? 'Processing...' : 'Reset Password'}
                </Button>
              </CardFooter>
            </Card>
          )}
          
          <Card>
            <CardHeader>
              <CardTitle>Troubleshooting Info</CardTitle>
              <CardDescription>This will help diagnose authentication issues</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div><strong>Current URL:</strong> {window.location.href}</div>
                <div><strong>Auth Callback URL:</strong> {window.location.origin}/auth/callback</div>
                <div><strong>Reset Password URL:</strong> {window.location.origin}/auth/callback?type=recovery</div>
                <div><strong>Environment:</strong> {import.meta.env.MODE}</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="database" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Database Test</CardTitle>
              <CardDescription>Test writing to the Supabase database</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="testMessage">Test Message</Label>
                <Input
                  id="testMessage"
                  placeholder="Enter a test message to save"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </div>
              <Button 
                className="w-full" 
                onClick={testDataSaving}
                disabled={isLoading || !testMessage.trim()}
              >
                {isLoading ? 'Testing...' : 'Test Data Saving'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Connection Logs</CardTitle>
              <CardDescription>Detailed connection information</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-100 p-3 rounded-md text-sm h-64 overflow-y-auto">
                {results.length === 0 ? (
                  <p className="text-gray-500">Results will appear here...</p>
                ) : (
                  results.map((result, i) => (
                    <div key={i} className="mb-1">
                      {result}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
