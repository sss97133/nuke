import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export default function TestSupabase() {
  const [testMessage, setTestMessage] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Test reading from Supabase on component load
  useEffect(() => {
    async function testConnection() {
      try {
        setResults(prev => [...prev, "Testing Supabase connection..."]);
        
        // Test authentication state
        const { data: { session } } = await supabase.auth.getSession();
        setResults(prev => [...prev, `Session exists: ${!!session}`]);
        
        if (session) {
          setResults(prev => [...prev, `User is authenticated: ${session.user.email}`]);
        } else {
          setResults(prev => [...prev, "No active session - testing public access"]);
        }
        
        // Simple read test
        const { data: vehicles, error: readError } = await supabase
          .from('vehicles')
          .select('id, make, model')
          .limit(5);
        
        if (readError) {
          setResults(prev => [...prev, `READ ERROR: ${readError.message}`]);
        } else {
          setResults(prev => [...prev, `Successfully read ${vehicles?.length || 0} vehicles from database`]);
        }
        
      } catch (e) {
        setResults(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`]);
      }
    }
    
    testConnection();
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

  return (
    <div className="container mx-auto p-4 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Supabase Connection Test</CardTitle>
          <CardDescription>
            Test if user data can be properly saved to the database
          </CardDescription>
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
          
          <div className="mt-4">
            <h3 className="font-medium mb-2">Test Results:</h3>
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
          </div>
        </CardContent>
        <CardFooter className="text-xs text-gray-500">
          This page tests if the Supabase client is working correctly across environments
        </CardFooter>
      </Card>
    </div>
  );
}
