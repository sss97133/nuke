
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Globe } from 'lucide-react';

interface WebImportTabProps {
  className?: string;
}

const WebImportTab: React.FC<WebImportTabProps> = ({ className }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from Website</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="url">Website URL</Label>
          <div className="flex gap-2">
            <Input id="url" placeholder="https://example.com/data-source" />
            <Button type="button">Fetch</Button>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="selector">Data Selector (CSS/XPath)</Label>
          <Input id="selector" placeholder="table.data-table or //table[@class='data-table']" />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="auth">Authentication (Optional)</Label>
          <Textarea id="auth" placeholder="API key or auth details if required" />
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-4">
        <Button className="ml-auto">
          <Globe className="h-4 w-4 mr-2" />
          Start Web Import
        </Button>
      </CardFooter>
    </Card>
  );
};

export default WebImportTab;
