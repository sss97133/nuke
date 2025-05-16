
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocLink } from '../layout/DocLink';

interface DownloadResourcesProps {
  onDocLinkClick: (path: string) => void;
}

export const DownloadResources: React.FC<DownloadResourcesProps> = ({ onDocLinkClick }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Download Resources</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {[
            { text: "PDF User Guide", size: "3.5 MB", path: "/downloads/user-guide.pdf" },
            { text: "Video Tutorials", size: "250 MB", path: "/downloads/video-tutorials.zip" },
            { text: "Sample Templates", size: "1.2 MB", path: "/downloads/templates.zip" },
            { text: "API Reference", size: "2.8 MB", path: "/downloads/api-reference.pdf" }
          ].map((resource, index) => (
            <DocLink 
              key={index} 
              href={resource.path}
              isExternal={true}
            >
              <span>{resource.text}</span>
              <span className="text-sm text-muted-foreground">{resource.size}</span>
            </DocLink>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
