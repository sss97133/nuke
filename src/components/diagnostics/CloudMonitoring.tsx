
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Cloud, RefreshCw, Layers, Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CloudMonitoring = () => {
  const { toast } = useToast();
  const [selectedVehicle, setSelectedVehicle] = useState("");
  
  // Mock vehicle data
  const vehicles = [
    { id: "1", name: "2019 Toyota Camry", connected: true, lastSync: "10 minutes ago" },
    { id: "2", name: "2020 Honda Civic", connected: true, lastSync: "3 hours ago" },
    { id: "3", name: "2018 Ford F-150", connected: false, lastSync: "2 days ago" }
  ];
  
  // Mock telemetry data
  const telemetryData = [
    { parameter: "Battery Voltage", value: "12.6V", status: "normal" },
    { parameter: "Engine Temperature", value: "89°C", status: "normal" },
    { parameter: "Oil Pressure", value: "54 psi", status: "normal" },
    { parameter: "Fuel Level", value: "78%", status: "normal" },
    { parameter: "Tire Pressure (FL)", value: "33 psi", status: "warning" },
    { parameter: "Tire Pressure (FR)", value: "35 psi", status: "normal" },
    { parameter: "Tire Pressure (RL)", value: "34 psi", status: "normal" },
    { parameter: "Tire Pressure (RR)", value: "34 psi", status: "normal" },
  ];
  
  const handleRefresh = () => {
    toast({
      title: "Refreshing Cloud Data",
      description: "Fetching the latest telemetry from the cloud..."
    });
  };
  
  const handleSelectVehicle = (value: string) => {
    setSelectedVehicle(value);
    toast({
      title: "Vehicle Selected",
      description: `Displaying cloud data for ${vehicles.find(v => v.id === value)?.name}`
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Cloud-Connected Vehicles</CardTitle>
              <CardDescription>Monitor your vehicles with real-time cloud telemetry</CardDescription>
            </div>
            <div className="p-2 bg-blue-100 rounded-full">
              <Cloud className="h-5 w-5 text-blue-700" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <label className="text-sm font-medium mb-1 block">Select Vehicle</label>
            <Select 
              value={selectedVehicle} 
              onValueChange={handleSelectVehicle}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a vehicle" />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map(vehicle => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.name} {vehicle.connected ? '(Online)' : '(Offline)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Synced</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map(vehicle => (
                  <TableRow key={vehicle.id}>
                    <TableCell className="font-medium">{vehicle.name}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        vehicle.connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {vehicle.connected ? 'Online' : 'Offline'}
                      </span>
                    </TableCell>
                    <TableCell>{vehicle.lastSync}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">View</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      
      {selectedVehicle && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Cloud Monitoring Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
                    <span className="text-sm font-medium">Active</span>
                  </div>
                  <span className="text-xs text-muted-foreground">Since 3 days ago</span>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Data Transfer</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Layers className="w-4 h-4 mr-2 text-blue-500" />
                    <span className="text-sm font-medium">2.7 GB</span>
                  </div>
                  <span className="text-xs text-muted-foreground">This month</span>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Last Update</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Clock className="w-4 h-4 mr-2 text-blue-500" />
                    <span className="text-sm font-medium">5 minutes ago</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleRefresh}>
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>Live Telemetry</CardTitle>
                  <CardDescription>
                    Real-time data from {vehicles.find(v => v.id === selectedVehicle)?.name}
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleRefresh} className="flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {telemetryData.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.parameter}</TableCell>
                      <TableCell>{item.value}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          item.status === 'normal' ? 'bg-green-100 text-green-800' : 
                          item.status === 'warning' ? 'bg-yellow-100 text-yellow-800' : 
                          'bg-red-100 text-red-800'
                        }`}>
                          {item.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1">Export Data</Button>
                <Button variant="outline" className="flex-1">View History</Button>
                <Button className="flex-1">Configure Alerts</Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default CloudMonitoring;
