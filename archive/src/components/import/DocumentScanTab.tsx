
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Image, Upload } from 'lucide-react';

interface DocumentScanTabProps {
  className?: string;
}

const DocumentScanTab: React.FC<DocumentScanTabProps> = ({ className }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Document Scanning</CardTitle>
      </CardHeader>
      <CardContent className="py-6">
        <div className="text-center py-6">
          <Image className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-medium mb-1">Scan Documents</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Use your camera to scan documents and extract data
          </p>
          <div className="flex justify-center gap-4">
            <Button>
              <Image className="h-4 w-4 mr-2" />
              Open Camera
            </Button>
            <Button variant="outline">
              <Upload className="h-4 w-4 mr-2" />
              Upload Image
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default DocumentScanTab;
