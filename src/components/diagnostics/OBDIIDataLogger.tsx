
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Terminal, Database, Plug } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const OBDIIDataLogger = () => {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [isLogging, setIsLogging] = useState(false);
  
  // Mock vehicle data
  const vehicles = [
    { id: "1", name: "2019 Toyota Camry" },
    { id: "2", name: "2020 Honda Civic" },
    { id: "3", name: "2018 Ford F-150" }
  ];
  
  // Mock OBD-II parameters data
  const obdParameters = [
    { id: "1", name: "Engine RPM", value: "1240", unit: "rpm" },
    { id: "2", name: "Vehicle Speed", value: "0", unit: "km/h" },
    { id: "3", name: "Coolant Temperature", value: "89", unit: "°C" },
    { id: "4", name: "Engine Load", value: "23", unit: "%" },
    { id: "5", name: "Fuel Level", value: "78", unit: "%" },
    { id: "6", name: "Throttle Position", value: "15", unit: "%" },
  ];
  
  const handleConnect = () => {
    if (!selectedVehicle) {
      toast({
        title: "Error",
        description: "Please select a vehicle first",
        variant: "destructive"
      });
      return;
    }

    setIsConnected(true);
    toast({
      title: "Connected",
      description: `Successfully connected to OBD-II interface for ${vehicles.find(v => v.id === selectedVehicle)?.name}`,
    });
  };
  
  const handleDisconnect = () => {
    setIsConnected(false);
    setIsLogging(false);
    toast({
      title: "Disconnected",
      description: "OBD-II interface disconnected",
    });
  };
  
  const toggleLogging = () => {
    setIsLogging(!isLogging);
    toast({
      title: isLogging ? "Logging Stopped" : "Logging Started",
      description: isLogging 
        ? "OBD-II data logging has been stopped" 
        : "OBD-II data is now being logged to your vehicle service history",
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>OBD-II Connection</CardTitle>
              <CardDescription>Connect to your vehicle's onboard diagnostics</CardDescription>
            </div>
            <div className="p-2 bg-blue-100 rounded-full">
              <Plug className="h-5 w-5 text-blue-700" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1 block">Select Vehicle</label>
              <Select 
                value={selectedVehicle} 
                onValueChange={setSelectedVehicle}
                disabled={isConnected}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map(vehicle => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isConnected ? (
              <Button onClick={handleConnect} disabled={!selectedVehicle}>
                Connect
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleDisconnect}>
                Disconnect
              </Button>
            )}
          </div>
          
          {isConnected && (
            <div className="flex justify-between items-center pt-4 border-t">
              <span className="text-sm">Status: <span className="text-green-600 font-medium">Connected</span></span>
              <Button 
                variant={isLogging ? "destructive" : "default"}
                onClick={toggleLogging}
              >
                {isLogging ? "Stop Logging" : "Start Logging"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      
      {isConnected && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Live OBD-II Data</CardTitle>
                <CardDescription>
                  Real-time parameters from {vehicles.find(v => v.id === selectedVehicle)?.name}
                </CardDescription>
              </div>
              <div className="p-2 bg-green-100 rounded-full">
                <Terminal className="h-5 w-5 text-green-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {obdParameters.map(param => (
                  <TableRow key={param.id}>
                    <TableCell className="font-medium">{param.name}</TableCell>
                    <TableCell>{param.value}</TableCell>
                    <TableCell>{param.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            
            <div className="mt-4">
              <Button variant="outline" className="w-full">
                View Historical Data
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {isConnected && isLogging && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Data Logging</CardTitle>
                <CardDescription>Recording OBD-II parameters</CardDescription>
              </div>
              <div className="p-2 bg-purple-100 rounded-full">
                <Database className="h-5 w-5 text-purple-700" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span>Log duration:</span>
                <span className="font-medium">00:05:32</span>
              </div>
              <div className="flex justify-between">
                <span>Data points collected:</span>
                <span className="font-medium">342</span>
              </div>
              <div className="flex justify-between">
                <span>Log file size:</span>
                <span className="font-medium">1.2 MB</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline">Export Data</Button>
                <Button variant="outline">Share to Cloud</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default OBDIIDataLogger;
