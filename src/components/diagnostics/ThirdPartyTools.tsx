
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Code, Terminal, Gauge, Monitor } from "lucide-react";

const ThirdPartyTools = () => {
  const { toast } = useToast();
  
  const handleToolLaunch = (toolName: string) => {
    toast({
      title: `Launching ${toolName}`,
      description: `Opening ${toolName} application...`,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Third-Party Diagnostic Tools</h2>
        <p className="text-muted-foreground">
          Connect with your favorite diagnostic software and hardware tools
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>MoTeC i2 Pro</CardTitle>
                <CardDescription>Professional data analysis software</CardDescription>
              </div>
              <div className="p-2 bg-blue-100 rounded-full">
                <Monitor className="h-5 w-5 text-blue-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Advanced data logging and analysis for professional motorsport and performance tuning.
            </p>
            <div className="flex gap-2">
              <Button 
                variant="default" 
                onClick={() => handleToolLaunch('MoTeC i2 Pro')}
                className="flex-1"
              >
                Launch Application
              </Button>
              <Button variant="outline" className="flex-1">Import Data</Button>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>OBDFusion</CardTitle>
                <CardDescription>Comprehensive OBD-II scanner app</CardDescription>
              </div>
              <div className="p-2 bg-green-100 rounded-full">
                <Gauge className="h-5 w-5 text-green-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Complete vehicle diagnostics with real-time dashboards and custom views.
            </p>
            <div className="flex gap-2">
              <Button 
                variant="default" 
                onClick={() => handleToolLaunch('OBDFusion')}
                className="flex-1"
              >
                Launch Application
              </Button>
              <Button variant="outline" className="flex-1">Sync Data</Button>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Tech2Win</CardTitle>
                <CardDescription>Manufacturer-specific diagnostics</CardDescription>
              </div>
              <div className="p-2 bg-purple-100 rounded-full">
                <Terminal className="h-5 w-5 text-purple-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Factory-level diagnostic capabilities for General Motors vehicles.
            </p>
            <div className="flex gap-2">
              <Button 
                variant="default" 
                onClick={() => handleToolLaunch('Tech2Win')}
                className="flex-1"
              >
                Launch Application
              </Button>
              <Button variant="outline" className="flex-1">View Reports</Button>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>TunerPro RT</CardTitle>
                <CardDescription>ECU tuning and calibration</CardDescription>
              </div>
              <div className="p-2 bg-orange-100 rounded-full">
                <Code className="h-5 w-5 text-orange-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Real-time ECU tuning and calibration for performance optimization.
            </p>
            <div className="flex gap-2">
              <Button 
                variant="default" 
                onClick={() => handleToolLaunch('TunerPro RT')}
                className="flex-1"
              >
                Launch Application
              </Button>
              <Button variant="outline" className="flex-1">Open Maps</Button>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Add New Tool</CardTitle>
          <CardDescription>Connect additional diagnostic software</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Configure new diagnostic tools by providing the connection details and integration settings.
          </p>
          <Button className="w-full">
            Configure New Tool
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default ThirdPartyTools;
