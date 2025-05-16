
import React, { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database, AlertCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface APIConnectionTabProps {
  className?: string;
}

const APIConnectionTab: React.FC<APIConnectionTabProps> = ({ className }) => {
  const [apiUrl, setApiUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [apiKey, setApiKey] = useState('');
  const [headers, setHeaders] = useState('');
  const [urlError, setUrlError] = useState('');
  const { toast } = useToast();

  const validateUrl = (url: string) => {
    if (!url.trim()) {
      setUrlError('API URL is required');
      return false;
    }

    try {
      // Check if the URL is valid using the URL constructor
      new URL(url);
      
      // Additional checks for API-like URL (contains http/https and has a domain)
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        setUrlError('URL must start with http:// or https://');
        return false;
      }
      
      setUrlError('');
      return true;
    } catch (error) {
      setUrlError('Please enter a valid URL');
      return false;
    }
  };

  const handleApiUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiUrl(value);
    
    // Clear error when user starts typing again
    if (urlError) {
      setUrlError('');
    }
  };

  const handleConnect = () => {
    if (validateUrl(apiUrl)) {
      // If URL is valid, show success toast and proceed with connection
      toast({
        title: "Connecting to API",
        description: `Establishing connection to ${apiUrl}`,
      });
      
      // Here you would typically add the API connection logic
      console.log('Connecting to API:', {
        url: apiUrl,
        method,
        apiKey: apiKey ? '****' : '',
        headers: headers || '{}'
      });
    } else {
      // If URL is invalid, show error toast
      toast({
        title: "Invalid API URL",
        description: urlError,
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="api-url">API Endpoint URL</Label>
          <Input 
            id="api-url" 
            placeholder="https://api.example.com/v1/resources" 
            value={apiUrl}
            onChange={handleApiUrlChange}
            className={urlError ? "border-red-500" : ""}
            onBlur={() => validateUrl(apiUrl)}
          />
          {urlError && (
            <Alert variant="destructive" className="mt-2 py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="ml-2">{urlError}</AlertDescription>
            </Alert>
          )}
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="method">Request Method</Label>
          <Select defaultValue="GET" onValueChange={setMethod} value={method}>
            <SelectTrigger>
              <SelectValue placeholder="Select request method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="api-key">API Key/Token</Label>
          <Input 
            id="api-key" 
            placeholder="Your API key or token" 
            type="password" 
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="headers">Headers (JSON)</Label>
          <Textarea 
            id="headers" 
            placeholder='{"Content-Type": "application/json", "Accept": "application/json"}' 
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-4">
        <Button 
          className="ml-auto" 
          onClick={handleConnect}
          disabled={!!urlError}
        >
          <Database className="h-4 w-4 mr-2" />
          Connect API
        </Button>
      </CardFooter>
    </Card>
  );
};

export default APIConnectionTab;
