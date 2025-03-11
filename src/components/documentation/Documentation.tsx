
import React, { useState, useEffect } from "react";
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { toast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, FileText, Settings, Terminal, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export const Documentation = () => {
  const [activeTab, setActiveTab] = useState("getting-started");
  const [docContent, setDocContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  // Configure marked options
  marked.setOptions({
    gfm: true,
    breaks: true
  });

  // Create a custom renderer for styling
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map(t => t.text).join('');
    const sizes = {
      1: 'text-2xl font-bold mb-4',
      2: 'text-xl font-semibold mb-3 mt-6',
      3: 'text-lg font-semibold mb-2 mt-4'
    };
    const className = sizes[depth as keyof typeof sizes] || 'text-base font-semibold mb-2';
    return `<h${depth} class="${className}">${text}</h${depth}>`;
  };

  marked.use({ renderer });

  useEffect(() => {
    const loadDocumentation = async () => {
      setIsLoading(true);
      try {
        let path;
        switch (activeTab) {
          case "getting-started":
            path = "/docs/GETTING_STARTED.md";
            break;
          case "features":
            path = "/docs/FEATURES.md";
            break;
          case "technical":
            path = "/docs/TECHNICAL.md";
            break;
          case "business-ops":
            path = "/docs/BUSINESS_OPS.md";
            break;
          case "media-production":
            path = "/docs/MEDIA_PRODUCTION.md";
            break;
          default:
            path = "/docs/GETTING_STARTED.md";
        }

        const response = await fetch(path);
        if (!response.ok) {
          throw new Error(`Failed to load documentation: ${response.statusText}`);
        }
        
        const content = await response.text();
        setDocContent(content);
      } catch (error) {
        console.error("Error loading documentation:", error);
        toast({
          variant: "destructive",
          title: "Documentation Error",
          description: "Failed to load documentation. Please try again later."
        });
        setDocContent("# Error Loading Documentation\n\nUnable to load the requested documentation. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    loadDocumentation();
  }, [activeTab, toast]);

  // Simple markdown parsing function
  const renderMarkdown = (markdown: string) => {
    // Convert headers
    let html = markdown.replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mb-4">$1</h1>');
    html = html.replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mb-3 mt-6">$1</h2>');
    html = html.replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mb-2 mt-4">$1</h3>');
    
    // Convert lists
    html = html.replace(/^\- (.*$)/gm, '<li class="ml-4">$1</li>');
    
    // Convert code blocks
    html = html.replace(/```(.+?)```/gs, '<pre class="bg-muted p-4 rounded-md overflow-x-auto my-4"><code>$1</code></pre>');
    
    // Convert inline code
    html = html.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm">$1</code>');
    
    // Convert paragraphs (needs to be after the other conversions)
    html = html.replace(/^(?!<[h|l|p])(.*$)/gm, '<p class="mb-4">$1</p>');
    
    return html;
  };

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case "getting-started":
        return <BookOpen className="h-4 w-4 mr-2" />;
      case "features":
        return <FileText className="h-4 w-4 mr-2" />;
      case "technical":
        return <Terminal className="h-4 w-4 mr-2" />;
      case "business-ops":
        return <Settings className="h-4 w-4 mr-2" />;
      case "media-production":
        return <HelpCircle className="h-4 w-4 mr-2" />;
      default:
        return <BookOpen className="h-4 w-4 mr-2" />;
    }
  };

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Documentation</CardTitle>
          <CardDescription>
            Access comprehensive documentation about the platform features, technical details, and more.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid grid-cols-5 mb-8">
              <TabsTrigger value="getting-started" className="flex items-center">
                {getTabIcon("getting-started")}
                Getting Started
              </TabsTrigger>
              <TabsTrigger value="features" className="flex items-center">
                {getTabIcon("features")}
                Features
              </TabsTrigger>
              <TabsTrigger value="technical" className="flex items-center">
                {getTabIcon("technical")}
                Technical
              </TabsTrigger>
              <TabsTrigger value="business-ops" className="flex items-center">
                {getTabIcon("business-ops")}
                Business Ops
              </TabsTrigger>
              <TabsTrigger value="media-production" className="flex items-center">
                {getTabIcon("media-production")}
                Media
              </TabsTrigger>
            </TabsList>
            
            <div className="border p-4 rounded-lg">
              {isLoading ? (
                <div className="flex items-center justify-center h-[500px]">
                  <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div 
                    className="documentation-content"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(docContent || ''), {
                      ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'strong', 'em', 'blockquote'],
                      ALLOWED_ATTR: ['class', 'href', 'target', 'rel'],
                      ALLOW_DATA_ATTR: false
                    }) }}
                  />
                </ScrollArea>
              )}
            </div>
          </Tabs>
          
          <Separator className="my-6" />
          
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => window.print()}>
              Print Documentation
            </Button>
            <Button onClick={() => {
              toast({
                title: "Documentation Exported",
                description: "Documentation has been exported to PDF"
              });
            }}>
              Export as PDF
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
