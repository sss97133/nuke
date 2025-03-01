
import React from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Chrome, Firefox, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

export const PluginDownload = () => {
  const { toast } = useToast();
  
  const handleDownload = (browser: string) => {
    // This would be replaced with actual download links in production
    const demoLinks = {
      chrome: "https://chrome.google.com/webstore/detail/your-plugin-id",
      firefox: "https://addons.mozilla.org/en-US/firefox/addon/your-plugin-id",
      edge: "https://microsoftedge.microsoft.com/addons/detail/your-plugin-id"
    };
    
    toast({
      title: "Download Started",
      description: `The ${browser} plugin download should begin shortly.`,
    });
    
    // In a real implementation, this would trigger the actual download
    // window.location.href = demoLinks[browser];
    
    // For demo purposes, we'll just open a new tab
    window.open(demoLinks[browser as keyof typeof demoLinks], '_blank');
  };
  
  return (
    <div className="container py-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Vehicle Discovery Plugin</h1>
      
      <div className="grid gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Discover Vehicles Across the Web</CardTitle>
            <CardDescription>
              Our browser plugin helps you find and track interesting vehicles from various sources online.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex items-start gap-4">
                <div className="bg-primary/10 p-3 rounded-full">
                  <Download className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Easy Vehicle Discovery</h3>
                  <p className="text-muted-foreground">
                    Browse car listings on popular sites and save interesting vehicles with a single click.
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-4">
                <div className="bg-primary/10 p-3 rounded-full">
                  <AlertCircle className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Automatic Data Capture</h3>
                  <p className="text-muted-foreground">
                    Our plugin intelligently extracts vehicle details including make, model, price, and more.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
              <Button 
                onClick={() => handleDownload('chrome')} 
                className="flex items-center gap-2"
                size="lg"
              >
                <Chrome className="h-5 w-5" />
                <span>Chrome</span>
              </Button>
              
              <Button 
                onClick={() => handleDownload('firefox')} 
                className="flex items-center gap-2"
                size="lg"
                variant="outline"
              >
                <Firefox className="h-5 w-5" />
                <span>Firefox</span>
              </Button>
              
              <Button 
                onClick={() => handleDownload('edge')} 
                className="flex items-center gap-2"
                size="lg"
                variant="outline"
              >
                <Chrome className="h-5 w-5" />
                <span>Edge</span>
              </Button>
            </div>
            
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Installation Instructions</AlertTitle>
              <AlertDescription>
                After downloading, follow your browser's instructions to install the extension.
                You may need to enable developer mode for local installations.
              </AlertDescription>
            </Alert>
          </CardFooter>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>How it Works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal pl-5 space-y-2">
              <li>Install the plugin for your preferred browser</li>
              <li>Browse vehicle listings on supported sites (Craigslist, Facebook Marketplace, etc.)</li>
              <li>Click the plugin icon when you find an interesting vehicle</li>
              <li>The vehicle details will be saved to your profile</li>
              <li>Access all your discovered vehicles from your profile dashboard</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PluginDownload;
