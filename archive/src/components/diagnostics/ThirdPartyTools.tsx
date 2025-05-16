
import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Link, ExternalLink, Download, CheckCircle2, XCircle } from "lucide-react";

interface Tool {
  id: string;
  name: string;
  description: string;
  status: "connected" | "disconnected";
  isInstalled: boolean;
  url: string;
}

const ThirdPartyTools = () => {
  const [tools, setTools] = useState<Tool[]>([
    {
      id: "1",
      name: "OBD Auto Doctor",
      description: "Professional car diagnostics software for OBD-2 compliant vehicles",
      status: "disconnected",
      isInstalled: true,
      url: "https://www.obdautodoctor.com/"
    },
    {
      id: "2",
      name: "Torque Pro",
      description: "Vehicle diagnostics app that uses OBD2 adapter to connect to your car",
      status: "connected",
      isInstalled: true,
      url: "https://torque-bhp.com/"
    },
    {
      id: "3",
      name: "FORScan",
      description: "Software scanner for Ford, Mazda, Lincoln and Mercury vehicles",
      status: "disconnected",
      isInstalled: false,
      url: "https://forscan.org/"
    },
    {
      id: "4",
      name: "EOBD Facile",
      description: "Complete diagnostic software for all vehicles",
      status: "disconnected",
      isInstalled: false,
      url: "https://www.eobd-facile.com/"
    }
  ]);

  const toggleConnection = (id: string) => {
    setTools(currentTools => 
      currentTools.map(tool => 
        tool.id === id 
          ? { ...tool, status: tool.status === "connected" ? "disconnected" : "connected" } 
          : tool
      )
    );
  };

  const installTool = (id: string) => {
    setTools(currentTools => 
      currentTools.map(tool => 
        tool.id === id 
          ? { ...tool, isInstalled: true } 
          : tool
      )
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {tools.map(tool => (
        <Card key={tool.id}>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-lg">{tool.name}</CardTitle>
                <CardDescription className="mt-1">{tool.description}</CardDescription>
              </div>
              {tool.isInstalled && (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-muted-foreground">Connect</span>
                  <Switch 
                    checked={tool.status === "connected"}
                    onCheckedChange={() => toggleConnection(tool.id)}
                  />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <span className="text-sm">Status:</span>
              <span className="flex items-center">
                {tool.status === "connected" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                    <span className="text-green-500">Connected</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground mr-1" />
                    <span className="text-muted-foreground">Disconnected</span>
                  </>
                )}
              </span>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" size="sm" className="flex items-center" asChild>
              <a href={tool.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Website
              </a>
            </Button>
            
            {!tool.isInstalled ? (
              <Button size="sm" className="flex items-center" onClick={() => installTool(tool.id)}>
                <Download className="h-4 w-4 mr-2" />
                Install
              </Button>
            ) : (
              <Button size="sm" variant="secondary" className="flex items-center" disabled={tool.status !== "connected"}>
                <Link className="h-4 w-4 mr-2" />
                Connect Data
              </Button>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
};

export default ThirdPartyTools;
