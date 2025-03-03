
import React, { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Globe, Upload, FileText } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

interface WebImportTabProps {
  className?: string;
}

const WebImportTab: React.FC<WebImportTabProps> = ({ className }) => {
  const [url, setUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const handleFetch = () => {
    if (!url) {
      toast({
        title: "URL required",
        description: "Please enter a valid URL to fetch data from",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Fetching data",
      description: `Retrieving data from ${url}`,
    });
    // Additional fetch logic would go here
  };

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      
      // Validate file type
      const validFileTypes = ['html', 'xml', 'json', 'csv'];
      if (!fileExtension || !validFileTypes.includes(fileExtension)) {
        toast({
          title: "Invalid file type",
          description: `Please select an HTML, XML, JSON, or CSV file. You selected: ${fileExtension?.toUpperCase() || 'Unknown'}`,
          variant: "destructive",
        });
        return;
      }
      
      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `Maximum file size is 10MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`,
          variant: "destructive",
        });
        return;
      }
      
      setSelectedFile(file);
      toast({
        title: "File selected for web import",
        description: `${file.name} (${(file.size / 1024).toFixed(2)} KB) - ${fileExtension.toUpperCase()}`,
      });
    }
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("File input change triggered");
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      
      // Validate file type
      const validFileTypes = ['html', 'xml', 'json', 'csv'];
      if (!fileExtension || !validFileTypes.includes(fileExtension)) {
        toast({
          title: "Invalid file type",
          description: `Please select an HTML, XML, JSON, or CSV file. You selected: ${fileExtension?.toUpperCase() || 'Unknown'}`,
          variant: "destructive",
        });
        return;
      }
      
      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        toast({
          title: "File too large",
          description: `Maximum file size is 10MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`,
          variant: "destructive",
        });
        return;
      }
      
      setSelectedFile(file);
      toast({
        title: "File selected for web import",
        description: `${file.name} (${(file.size / 1024).toFixed(2)} KB) - ${fileExtension.toUpperCase()}`,
      });
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
  };

  const handleBrowseClick = () => {
    console.log("Browse button clicked");
    if (fileInputRef.current) {
      console.log("Triggering file input click");
      fileInputRef.current.click();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from Website</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="url">Website URL</Label>
          <div className="flex gap-2">
            <Input 
              id="url" 
              placeholder="https://example.com/data-source" 
              value={url}
              onChange={handleUrlChange}
            />
            <Button type="button" onClick={handleFetch}>Fetch</Button>
          </div>
        </div>

        <div className="space-y-4">
          <Label>Or Drop a Web File</Label>
          <div
            className={`border-2 ${isDragging ? 'border-primary bg-primary/5' : 'border-dashed'} rounded-lg p-6 text-center transition-colors`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {!selectedFile ? (
              <>
                <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-medium mb-1">Drop your web file here</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Or click to browse for a file
                </p>
                <Input
                  type="file"
                  className="hidden"
                  id="web-file-upload"
                  onChange={handleFileChange}
                  accept=".html,.xml,.json,.csv"
                  ref={fileInputRef}
                />
                <Button 
                  variant="outline" 
                  type="button" 
                  onClick={handleBrowseClick}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Browse Web Files
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Supported formats: HTML, XML, JSON, CSV (Max 10MB)
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <FileText className="h-8 w-8 text-primary mx-auto mb-2" />
                <h3 className="font-medium">{selectedFile.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </p>
                <Button variant="outline" size="sm" onClick={clearFile} className="mt-2">
                  Choose Different File
                </Button>
              </div>
            )}
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
