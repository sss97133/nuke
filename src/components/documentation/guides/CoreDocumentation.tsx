
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BookOpen, FileText, Settings, Car, Package, Wrench, Users, BarChart, Building, Video, LineChart, Coins, LayoutPanelTop } from 'lucide-react';
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
        <p className="mb-4">
          Welcome to the comprehensive documentation for our vehicle management system. 
          This guide will help you navigate through all the features and capabilities of the platform.
        </p>
        
        <DocSection icon={<BookOpen className="h-5 w-5 text-blue-500" />} title="Core Features">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/features/vehicle-management" onClick={onDocLinkClick}>
              <Car className="h-4 w-4 mr-2" />
              Vehicle Management
            </DocLink>
            <DocLink href="/docs/features/inventory-management" onClick={onDocLinkClick}>
              <Package className="h-4 w-4 mr-2" />
              Inventory Management
            </DocLink>
            <DocLink href="/docs/features/service-operations" onClick={onDocLinkClick}>
              <Wrench className="h-4 w-4 mr-2" />
              Service Operations
            </DocLink>
            <DocLink href="/docs/features/professional-development" onClick={onDocLinkClick}>
              <Users className="h-4 w-4 mr-2" />
              Professional Development
            </DocLink>
            <DocLink href="/docs/features/analytics-diagnostics" onClick={onDocLinkClick}>
              <BarChart className="h-4 w-4 mr-2" />
              Analytics & Diagnostics
            </DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<Building className="h-5 w-5 text-purple-500" />} title="Business Operations">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/business-ops/onboarding" onClick={onDocLinkClick}>
              Business Onboarding System
            </DocLink>
            <DocLink href="/docs/business-ops/garage-management" onClick={onDocLinkClick}>
              Garage Management
            </DocLink>
            <DocLink href="/docs/business-ops/analytics" onClick={onDocLinkClick}>
              Business Analytics
            </DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<Video className="h-5 w-5 text-red-500" />} title="Media Production">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/media-production/workspace" onClick={onDocLinkClick}>
              Workspace Media Production
            </DocLink>
            <DocLink href="/docs/media-production/streaming" onClick={onDocLinkClick}>
              Technician Streaming Platform
            </DocLink>
            <DocLink href="/docs/media-production/content" onClick={onDocLinkClick}>
              Long Form Source Material
            </DocLink>
            <DocLink href="/docs/media-production/studio" onClick={onDocLinkClick}>
              Studio Configuration
            </DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<LineChart className="h-5 w-5 text-green-500" />} title="Market Analysis">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/market-analysis/valuation" onClick={onDocLinkClick}>
              Vehicle Valuation Tools
            </DocLink>
            <DocLink href="/docs/market-analysis/token-economics" onClick={onDocLinkClick}>
              Token Economics
            </DocLink>
            <DocLink href="/docs/market-analysis/predictive" onClick={onDocLinkClick}>
              Predictive Analytics
            </DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<Coins className="h-5 w-5 text-yellow-500" />} title="Token & Staking">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/predictive-staking/system" onClick={onDocLinkClick}>
              Token Staking System
            </DocLink>
            <DocLink href="/docs/predictive-staking/dashboard" onClick={onDocLinkClick}>
              Analytics Dashboard
            </DocLink>
            <DocLink href="/docs/predictive-staking/ai" onClick={onDocLinkClick}>
              AI-Powered Predictions
            </DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<LayoutPanelTop className="h-5 w-5 text-indigo-500" />} title="Studio Module">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/studio/configuration" onClick={onDocLinkClick}>
              Configuration Tools
            </DocLink>
            <DocLink href="/docs/studio/recording" onClick={onDocLinkClick}>
              Recording Management
            </DocLink>
            <DocLink href="/docs/studio/podcasting" onClick={onDocLinkClick}>
              Podcasting Tools
            </DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<Settings className="h-5 w-5 text-gray-500" />} title="Technical Documentation">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/technical/architecture" onClick={onDocLinkClick}>
              System Architecture
            </DocLink>
            <DocLink href="/docs/technical/data-models" onClick={onDocLinkClick}>
              Data Models
            </DocLink>
            <DocLink href="/docs/technical/api" onClick={onDocLinkClick}>
              API Reference
            </DocLink>
            <DocLink href="/docs/technical/security" onClick={onDocLinkClick}>
              Security Implementation
            </DocLink>
          </div>
        </DocSection>
        
        <Separator />
        
        <DocSection icon={<FileText className="h-5 w-5 text-orange-500" />} title="Additional Resources">
          <div className="grid gap-3 mt-2">
            <DocLink href="/docs/user-manual" onClick={onDocLinkClick}>
              User Manual
            </DocLink>
            <DocLink href="/docs/admin-guide" onClick={onDocLinkClick}>
              Administrator Guide
            </DocLink>
            <DocLink href="/docs/best-practices" onClick={onDocLinkClick}>
              Best Practices
            </DocLink>
            <DocLink href="/docs/faq" onClick={onDocLinkClick}>
              Frequently Asked Questions
            </DocLink>
            <DocLink href="/docs/troubleshooting" onClick={onDocLinkClick}>
              Troubleshooting Guide
            </DocLink>
            <DocLink href="/docs/integrations" onClick={onDocLinkClick}>
              Third-Party Integrations
            </DocLink>
          </div>
        </DocSection>
      </CardContent>
    </Card>
  );
};
