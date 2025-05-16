
import React, { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Globe } from 'lucide-react';
import { UrlInput } from './web-import/UrlInput';
import { FileDropZone } from './web-import/FileDropZone';
import { DataSelectors } from './web-import/DataSelectors';

interface WebImportTabProps {
  className?: string;
}

const WebImportTab: React.FC<WebImportTabProps> = ({ className }) => {
  const [url, setUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from Website</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <UrlInput url={url} setUrl={setUrl} />
        <div className="space-y-4">
          <Label>Or Drop a Web File</Label>
          <FileDropZone 
            selectedFile={selectedFile} 
            setSelectedFile={setSelectedFile} 
          />
        </div>
        <DataSelectors />
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
