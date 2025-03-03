
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database } from 'lucide-react';

interface APIConnectionTabProps {
  className?: string;
}

const APIConnectionTab: React.FC<APIConnectionTabProps> = ({ className }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>API Connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="api-url">API Endpoint URL</Label>
          <Input id="api-url" placeholder="https://api.example.com/v1/resources" />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="method">Request Method</Label>
          <Select defaultValue="GET">
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
          <Input id="api-key" placeholder="Your API key or token" type="password" />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="headers">Headers (JSON)</Label>
          <Textarea id="headers" placeholder='{"Content-Type": "application/json", "Accept": "application/json"}' />
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-4">
        <Button className="ml-auto">
          <Database className="h-4 w-4 mr-2" />
          Connect API
        </Button>
      </CardFooter>
    </Card>
  );
};

export default APIConnectionTab;
