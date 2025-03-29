
import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { testRealtimeConnection, validateSupabaseConfig, checkForCorsIssues } from "@/utils/websocket-helpers";

export const WebSocketDiagnostics = () => {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{success: boolean; message: string} | null>(null);
  const [configValid, setConfigValid] = useState(true);
  const [corsPossibleIssue, setCorsPossibleIssue] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setIsTesting(true);
    setConnectionStatus('checking');
    setErrorMessage(null);
    
    // Check configuration
    const isConfigValid = validateSupabaseConfig();
    setConfigValid(isConfigValid);
    
    if (!isConfigValid) {
      setConnectionStatus('disconnected');
      setErrorMessage('Invalid Supabase configuration. Check your environment variables.');
      setIsTesting(false);
      return;
    }
    
    // Check for potential CORS issues
    const corsIssue = checkForCorsIssues();
    setCorsPossibleIssue(corsIssue);
    
    // Test the connection
    try {
      const result = await testRealtimeConnection();
      setTestResult(result);
      setConnectionStatus(result.success ? 'connected' : 'disconnected');
      
      if (!result.success) {
        setErrorMessage(result.message);
      }
    } catch (error) {
      setConnectionStatus('disconnected');
      setErrorMessage('Error testing connection: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="flex items-center">
              <Wifi className="mr-2 h-5 w-5" />
              WebSocket Diagnostics
            </CardTitle>
            <CardDescription>
              Check and troubleshoot WebSocket connections
            </CardDescription>
          </div>
          <Badge 
            variant={connectionStatus === 'connected' ? 'default' : 'destructive'} 
            className="ml-auto"
          >
            {connectionStatus === 'connected' 
              ? 'Connected' 
              : connectionStatus === 'checking' 
                ? 'Checking...' 
                : 'Disconnected'
            }
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configValid && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Configuration Error</AlertTitle>
            <AlertDescription>
              Supabase URL or anon key is invalid or missing. Check your environment variables.
            </AlertDescription>
          </Alert>
        )}
        
        {corsPossibleIssue && (
          <Alert variant="warning" className="bg-amber-50 border-amber-200">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Potential CORS Issue</AlertTitle>
            <AlertDescription>
              You may be experiencing CORS issues. Ensure your Supabase project has the correct allowed origins.
            </AlertDescription>
          </Alert>
        )}
        
        {errorMessage && (
          <Alert variant="destructive">
            <WifiOff className="h-4 w-4" />
            <AlertTitle>Connection Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        
        {connectionStatus === 'connected' && (
          <Alert variant="default" className="bg-green-50 border-green-200">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800">Connection Successful</AlertTitle>
            <AlertDescription className="text-green-700">
              WebSocket connection to Supabase Realtime is working properly.
            </AlertDescription>
          </Alert>
        )}
        
        <div className="bg-muted p-4 rounded-md">
          <h4 className="text-sm font-medium mb-2">Diagnostics Information</h4>
          <ul className="space-y-1 text-sm">
            <li><span className="font-medium">URL Configured:</span> {configValid ? 'Yes' : 'No'}</li>
            <li><span className="font-medium">Status:</span> {testResult?.message || 'Not tested'}</li>
            <li><span className="font-medium">Host:</span> {window.location.hostname}</li>
            <li><span className="font-medium">Protocol:</span> {window.location.protocol}</li>
          </ul>
        </div>
        
        <Button 
          onClick={checkConnection}
          disabled={isTesting}
          className="w-full"
        >
          {isTesting ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Testing Connection...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Test Connection
            </>
          )}
        </Button>
        
        <div className="text-sm text-muted-foreground">
          <h4 className="font-medium mb-1">Troubleshooting Tips:</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Check if your Supabase project is online</li>
            <li>Verify your project URL and anon key in environment variables</li>
            <li>Ensure the relevant tables are added to the realtime publication</li>
            <li>Add your website domain to the allowed origins in Supabase</li>
            <li>Check for browser extensions that might block WebSocket connections</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
