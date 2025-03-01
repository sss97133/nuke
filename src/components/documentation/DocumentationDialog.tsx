
import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, FileText, Settings, Terminal, HelpCircle } from "lucide-react";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface DocumentationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DocumentationDialog = ({ open, onOpenChange }: DocumentationDialogProps) => {
  const [activeTab, setActiveTab] = useState("getting-started");
  const [docContent, setDocContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  React.useEffect(() => {
    const loadDocumentation = async () => {
      if (!open) return;
      
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
        setDocContent("# Error Loading Documentation\n\nUnable to load the requested documentation. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    loadDocumentation();
  }, [activeTab, open]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-2xl">Documentation</DialogTitle>
          <DialogDescription>
            Access comprehensive documentation about the platform features, technical details, and more.
          </DialogDescription>
        </DialogHeader>
        
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
              <div className="flex items-center justify-center h-[400px]">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div 
                  className="documentation-content"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(docContent) }}
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
          <Button>
            Export as PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
