
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BookOpen, FileText, Settings } from 'lucide-react';
import { DocSection } from '../layout/DocSection';
import { DocLink } from '../layout/DocLink';

interface CoreDocumentationProps {
  onDocLinkClick: (path: string) => void;
}

export const CoreDocumentation: React.FC<CoreDocumentationProps> = ({ onDocLinkClick }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting Started</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          Welcome to the documentation for the vehicle management system. 
          This guide will help you get started with the platform and learn about its features.
        </p>
        
        <DocSection icon={<BookOpen className="h-5 w-5 text-blue-500" />} title="Core Features">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/features/vehicle-management" onClick={onDocLinkClick}>Vehicle Management Guide</DocLink>
            <DocLink href="/docs/features/inventory-management" onClick={onDocLinkClick}>Inventory Management</DocLink>
            <DocLink href="/docs/features/service-operations" onClick={onDocLinkClick}>Service Operations</DocLink>
            <DocLink href="/docs/features/professional-development" onClick={onDocLinkClick}>Professional Development</DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<Settings className="h-5 w-5 text-purple-500" />} title="Business Operations">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/business-ops" onClick={onDocLinkClick}>Business Onboarding System</DocLink>
            <DocLink href="/docs/business-ops" onClick={onDocLinkClick}>Garage Management</DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<FileText className="h-5 w-5 text-green-500" />} title="Advanced Topics">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/media-production" onClick={onDocLinkClick}>Media Production</DocLink>
            <DocLink href="/docs/market-analysis" onClick={onDocLinkClick}>Market Analysis</DocLink>
            <DocLink href="/docs/predictive-staking" onClick={onDocLinkClick}>Predictive Staking</DocLink>
            <DocLink href="/docs/studio" onClick={onDocLinkClick}>Studio Architecture</DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<FileText className="h-5 w-5 text-green-500" />} title="Documents">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/user-manual" onClick={onDocLinkClick}>User Manual</DocLink>
            <DocLink href="/docs/admin-guide" onClick={onDocLinkClick}>Administrator Guide</DocLink>
            <DocLink href="/docs/best-practices" onClick={onDocLinkClick}>Best Practices</DocLink>
          </div>
        </DocSection>
      </CardContent>
    </Card>
  );
};
