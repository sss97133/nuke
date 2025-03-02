
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, FileText } from 'lucide-react';
import { DocLink } from '../layout/DocLink';

interface QuickLinksProps {
  onDocLinkClick: (path: string) => void;
}

export const QuickLinks: React.FC<QuickLinksProps> = ({ onDocLinkClick }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Links</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {[
            { icon: <BookOpen className="h-4 w-4" />, text: "Getting Started", path: "/docs/getting-started" },
            { icon: <FileText className="h-4 w-4" />, text: "Technical Docs", path: "/docs/technical" }
          ].map((link, index) => (
            <DocLink key={index} href={link.path} onClick={onDocLinkClick}>
              {link.icon}
              <span>{link.text}</span>
            </DocLink>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
