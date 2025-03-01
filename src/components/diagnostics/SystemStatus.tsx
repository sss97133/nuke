
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Database, Server, Code, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const SystemStatus = () => {
  const { toast } = useToast();
  
  const handleDeviceScan = () => {
    toast({
      title: "Scanning Devices",
      description: "Looking for connected diagnostic devices..."
    });
  };
  
  const handleTroubleshoot = () => {
    toast({
      title: "Troubleshooting Mode",
      description: "Opening advanced troubleshooting tools..."
    });
  };

  // Mock connected devices
  const connectedDevices = [
    { 
      id: "1", 
      name: "OBDLink MX+", 
      type: "Bluetooth OBD-II", 
      status: "Connected", 
      battery: "N/A", 
      firmware: "v4.3" 
    },
    { 
      id: "2", 
      name: "Autel MaxiSys", 
      type: "Professional Scanner", 
      status: "Connected", 
      battery: "87%", 
      firmware: "MS919 v2.45" 
    },
    { 
      id: "3", 
      name: "Launch X431", 
      type: "Diagnostic Tablet", 
      status: "Disconnected", 
      battery: "Charging", 
      firmware: "v8.23.002" 
    }
  ];
  
  // Mock connectivity status
  const connectivityStatus = [
    { service: "Local Network", status: "Connected", latency: "5ms" },
    { service: "Cloud Sync", status: "Connected", latency: "120ms" },
    { service: "OEM Server", status: "Connected", latency: "210ms" },
    { service: "Firmware Updates", status: "Available", latency: "N/A" },
  ];
  
  // Mock issues
  const systemIssues = [
    { 
      id: "1", 
      description: "OBD-II Connectivity", 
      status: "Normal", 
      details: "All systems operating normally" 
    },
    { 
      id: "2", 
      description: "Bluetooth Connection", 
      status: "Warning", 
      details: "Intermittent signal detected" 
    },
    { 
      id: "3", 
      description: "USB Drivers", 
      status: "Normal", 
      details: "Up-to-date, version 2.12.5" 
    },
    { 
      id: "4", 
      description: "Data Storage", 
      status: "Normal", 
      details: "32.4 GB available (78%)" 
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Diagnostic Devices</CardTitle>
              <div className="p-1 bg-blue-100 rounded-full">
                <Server className="h-4 w-4 text-blue-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{connectedDevices.filter(d => d.status === "Connected").length}</div>
            <p className="text-xs text-muted-foreground">Connected devices</p>
            <Button 
              variant="link" 
              className="px-0 h-auto text-xs"
              onClick={handleDeviceScan}
            >
              Scan for new devices
            </Button>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">System Issues</CardTitle>
              <div className="p-1 bg-amber-100 rounded-full">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {systemIssues.filter(issue => issue.status !== "Normal").length}
            </div>
            <p className="text-xs text-muted-foreground">Active warnings</p>
            <Button 
              variant="link" 
              className="px-0 h-auto text-xs"
              onClick={handleTroubleshoot}
            >
              Troubleshoot issues
            </Button>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Data Sync</CardTitle>
              <div className="p-1 bg-green-100 rounded-full">
                <Database className="h-4 w-4 text-green-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">5 mins ago</div>
            <p className="text-xs text-muted-foreground">Last sync completed</p>
            <Button 
              variant="link" 
              className="px-0 h-auto text-xs"
            >
              View sync history
            </Button>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Connected Devices</CardTitle>
              <CardDescription>Diagnostic hardware connected to your system</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleDeviceScan}>
              Scan Devices
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Battery</TableHead>
                <TableHead>Firmware</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectedDevices.map(device => (
                <TableRow key={device.id}>
                  <TableCell className="font-medium">{device.name}</TableCell>
                  <TableCell>{device.type}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      device.status === 'Connected' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {device.status}
                    </span>
                  </TableCell>
                  <TableCell>{device.battery}</TableCell>
                  <TableCell>{device.firmware}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">Configure</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          <Button className="w-full mt-4">Add Device</Button>
        </CardContent>
      </Card>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Connectivity Status</CardTitle>
                <CardDescription>External service connections</CardDescription>
              </div>
              <div className="p-2 bg-blue-100 rounded-full">
                <Server className="h-4 w-4 text-blue-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectivityStatus.map((service, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{service.service}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        service.status === 'Connected' ? 'bg-green-100 text-green-800' : 
                        service.status === 'Available' ? 'bg-blue-100 text-blue-800' : 
                        'bg-red-100 text-red-800'
                      }`}>
                        {service.status}
                      </span>
                    </TableCell>
                    <TableCell>{service.latency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>System Diagnostics</CardTitle>
                <CardDescription>Connection and hardware issues</CardDescription>
              </div>
              <div className="p-2 bg-purple-100 rounded-full">
                <Code className="h-4 w-4 text-purple-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {systemIssues.map(issue => (
                  <TableRow key={issue.id}>
                    <TableCell className="font-medium">{issue.description}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        issue.status === 'Normal' ? 'bg-green-100 text-green-800' : 
                        issue.status === 'Warning' ? 'bg-yellow-100 text-yellow-800' : 
                        'bg-red-100 text-red-800'
                      }`}>
                        {issue.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{issue.details}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            
            <Button 
              variant="outline" 
              className="w-full mt-4"
              onClick={handleTroubleshoot}
            >
              Run Diagnostics
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SystemStatus;
