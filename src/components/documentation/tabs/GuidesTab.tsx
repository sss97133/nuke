
import React from 'react';
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BookOpen, FileText, Settings } from 'lucide-react';
import { DocSection } from '../layout/DocSection';
import { DocLink } from '../layout/DocLink';

export const GuidesTab = () => {
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
                <DocLink href="#">Vehicle Management Guide</DocLink>
                <DocLink href="#">Inventory Management</DocLink>
                <DocLink href="#">Service Operations</DocLink>
                <DocLink href="#">Professional Development</DocLink>
              </div>
            </DocSection>
            
            <Separator />
            
            <DocSection icon={<Settings className="h-5 w-5 text-purple-500" />} title="Business Operations">
              <div className="grid gap-3 mt-2">
                <DocLink href="#">Business Onboarding System</DocLink>
                <DocLink href="#">Garage Management</DocLink>
              </div>
            </DocSection>
            
            <Separator />
            
            <DocSection icon={<FileText className="h-5 w-5 text-green-500" />} title="Documents">
              <div className="grid gap-3 mt-2">
                <DocLink href="#">User Manual</DocLink>
                <DocLink href="#">Administrator Guide</DocLink>
                <DocLink href="#">Best Practices</DocLink>
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
                { icon: <BookOpen className="h-4 w-4" />, text: "Tutorials" },
                { icon: <FileText className="h-4 w-4" />, text: "API Documentation" }
              ].map((link, index) => (
                <DocLink key={index} href="#">
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
                { text: "PDF User Guide", size: "3.5 MB" },
                { text: "Video Tutorials", size: "250 MB" },
                { text: "Sample Templates", size: "1.2 MB" },
                { text: "API Reference", size: "2.8 MB" }
              ].map((resource, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted transition-colors cursor-pointer"
                >
                  <span>{resource.text}</span>
                  <span className="text-sm text-muted-foreground">{resource.size}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
