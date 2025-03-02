
import React, { useState } from 'react';
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BookOpen, FileText, Settings } from 'lucide-react';
import { DocSection } from '../layout/DocSection';
import { DocLink } from '../layout/DocLink';
import { DocContentDisplay } from '../content/DocContentDisplay';

// Import content files
const GETTING_STARTED = require('../../../../docs/GETTING_STARTED.md');
const FEATURES = require('../../../../docs/FEATURES.md');
const BUSINESS_OPS = require('../../../../docs/BUSINESS_OPS.md');
const MEDIA_PRODUCTION = require('../../../../docs/MEDIA_PRODUCTION.md');
const MARKET_ANALYSIS = require('../../../../docs/MARKET_ANALYSIS.md');
const PREDICTIVE_STAKING = require('../../../../docs/PREDICTIVE_STAKING.md');
const STUDIO = require('../../../../docs/STUDIO.md');
const TECHNICAL = require('../../../../docs/TECHNICAL.md');

interface DocContent {
  path: string;
  title: string;
  content: string;
  section?: string;
}

export const GuidesTab = () => {
  const [activeDoc, setActiveDoc] = useState<DocContent | null>(null);

  const docContents: Record<string, { title: string, content: string, section?: string }> = {
    '/docs/getting-started': { title: 'Getting Started Guide', content: GETTING_STARTED },
    '/docs/features': { title: 'Core Features', content: FEATURES },
    '/docs/features/vehicle-management': { title: 'Vehicle Management', content: FEATURES, section: '🚗 Vehicle Management' },
    '/docs/features/inventory-management': { title: 'Inventory Management', content: FEATURES, section: '📦 Inventory Management' },
    '/docs/features/service-operations': { title: 'Service Operations', content: FEATURES, section: '🔧 Service Operations' },
    '/docs/features/professional-development': { title: 'Professional Development', content: FEATURES, section: '👥 Professional Development' },
    '/docs/business-ops': { title: 'Business Operations', content: BUSINESS_OPS },
    '/docs/media-production': { title: 'Media Production', content: MEDIA_PRODUCTION },
    '/docs/market-analysis': { title: 'Market Analysis', content: MARKET_ANALYSIS },
    '/docs/predictive-staking': { title: 'Predictive Staking', content: PREDICTIVE_STAKING },
    '/docs/studio': { title: 'Studio Module Architecture', content: STUDIO },
    '/docs/technical': { title: 'Technical Documentation', content: TECHNICAL },
    '/docs/user-manual': { title: 'User Manual', content: 'User Manual content would be here.' },
    '/docs/admin-guide': { title: 'Administrator Guide', content: 'Administrator Guide content would be here.' },
    '/docs/best-practices': { title: 'Best Practices', content: 'Best Practices content would be here.' },
  };

  const handleDocLinkClick = (path: string) => {
    if (docContents[path]) {
      setActiveDoc({
        path,
        title: docContents[path].title,
        content: docContents[path].content,
        section: docContents[path].section
      });
    }
  };

  const handleBackClick = () => {
    setActiveDoc(null);
  };

  if (activeDoc) {
    return (
      <DocContentDisplay 
        title={activeDoc.title}
        content={activeDoc.content}
        onBack={handleBackClick}
        section={activeDoc.section}
      />
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-6">
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
                <DocLink href="/docs/features/vehicle-management" onClick={handleDocLinkClick}>Vehicle Management Guide</DocLink>
                <DocLink href="/docs/features/inventory-management" onClick={handleDocLinkClick}>Inventory Management</DocLink>
                <DocLink href="/docs/features/service-operations" onClick={handleDocLinkClick}>Service Operations</DocLink>
                <DocLink href="/docs/features/professional-development" onClick={handleDocLinkClick}>Professional Development</DocLink>
              </div>
            </DocSection>
            
            <Separator />
            
            <DocSection icon={<Settings className="h-5 w-5 text-purple-500" />} title="Business Operations">
              <div className="grid gap-3 mt-2">
                <DocLink href="/docs/business-ops" onClick={handleDocLinkClick}>Business Onboarding System</DocLink>
                <DocLink href="/docs/business-ops" onClick={handleDocLinkClick}>Garage Management</DocLink>
              </div>
            </DocSection>
            
            <Separator />
            
            <DocSection icon={<FileText className="h-5 w-5 text-green-500" />} title="Advanced Topics">
              <div className="grid gap-3 mt-2">
                <DocLink href="/docs/media-production" onClick={handleDocLinkClick}>Media Production</DocLink>
                <DocLink href="/docs/market-analysis" onClick={handleDocLinkClick}>Market Analysis</DocLink>
                <DocLink href="/docs/predictive-staking" onClick={handleDocLinkClick}>Predictive Staking</DocLink>
                <DocLink href="/docs/studio" onClick={handleDocLinkClick}>Studio Architecture</DocLink>
              </div>
            </DocSection>
            
            <Separator />
            
            <DocSection icon={<FileText className="h-5 w-5 text-green-500" />} title="Documents">
              <div className="grid gap-3 mt-2">
                <DocLink href="/docs/user-manual" onClick={handleDocLinkClick}>User Manual</DocLink>
                <DocLink href="/docs/admin-guide" onClick={handleDocLinkClick}>Administrator Guide</DocLink>
                <DocLink href="/docs/best-practices" onClick={handleDocLinkClick}>Best Practices</DocLink>
              </div>
            </DocSection>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Recent Updates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                {
                  version: "v2.3.1",
                  date: "May 15, 2024",
                  description: "Added support for multi-camera studio recording"
                },
                {
                  version: "v2.2.0",
                  date: "April 22, 2024",
                  description: "Enhanced inventory management system with AI suggestions"
                },
                {
                  version: "v2.1.5",
                  date: "March 10, 2024",
                  description: "Bug fixes and performance improvements"
                }
              ].map((update, index) => (
                <div key={index} className="border-l-2 border-primary pl-4">
                  <div className="flex justify-between">
                    <h3 className="font-medium">{update.version}</h3>
                    <span className="text-sm text-muted-foreground">{update.date}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{update.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="space-y-6">
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
                <DocLink key={index} href={link.path} onClick={handleDocLinkClick}>
                  {link.icon}
                  <span>{link.text}</span>
                </DocLink>
              ))}
            </div>
          </CardContent>
        </Card>
        
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
      </div>
    </div>
  );
};
