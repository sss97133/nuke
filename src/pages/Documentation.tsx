
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  FileText, BookOpen, FileCode, Settings, 
  HelpCircle, Link, Github, ExternalLink 
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

const DocSection = ({ 
  icon, 
  title, 
  children 
}: { 
  icon: React.ReactNode; 
  title: string; 
  children: React.ReactNode;
}) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
    <div>{children}</div>
  </div>
);

const DocLink = ({ 
  href, 
  children 
}: { 
  href: string; 
  children: React.ReactNode 
}) => (
  <a 
    href={href} 
    target="_blank" 
    rel="noopener noreferrer"
    className="flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted transition-colors"
  >
    {children}
    <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
  </a>
);

const Documentation = () => {
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6">
        <div className="space-y-2 mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
          <p className="text-muted-foreground">
            Reference materials, guides, and resources
          </p>
        </div>
        
        <Tabs defaultValue="guides">
          <TabsList className="mb-4">
            <TabsTrigger value="guides">User Guides</TabsTrigger>
            <TabsTrigger value="api">API Reference</TabsTrigger>
            <TabsTrigger value="tech">Technical Docs</TabsTrigger>
            <TabsTrigger value="support">Support</TabsTrigger>
          </TabsList>
          
          <TabsContent value="guides">
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
                        { icon: <HelpCircle className="h-4 w-4" />, text: "FAQs" },
                        { icon: <Github className="h-4 w-4" />, text: "GitHub Repository" },
                        { icon: <Link className="h-4 w-4" />, text: "Component Library" },
                        { icon: <BookOpen className="h-4 w-4" />, text: "Tutorials" },
                        { icon: <FileCode className="h-4 w-4" />, text: "API Documentation" }
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
          </TabsContent>
          
          <TabsContent value="api">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center p-10">
                  <FileCode className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-medium mb-2">API Documentation</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Comprehensive API reference for developers integrating with our platform
                  </p>
                  <div className="flex justify-center gap-4">
                    <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md">
                      View API Reference
                    </button>
                    <button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">
                      Download OpenAPI Spec
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="tech">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center p-10">
                  <Settings className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-medium mb-2">Technical Documentation</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Detailed technical specifications, architecture diagrams, and implementation guides
                  </p>
                  <div className="flex justify-center gap-4">
                    <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md">
                      System Architecture
                    </button>
                    <button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">
                      Integration Guides
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="support">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center p-10">
                  <HelpCircle className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-medium mb-2">Support Resources</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Get help, submit tickets, and connect with our support team
                  </p>
                  <div className="flex justify-center gap-4">
                    <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md">
                      Contact Support
                    </button>
                    <button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">
                      Troubleshooting Guide
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default Documentation;
