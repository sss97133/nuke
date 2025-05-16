
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Vehicle } from '@/components/vehicles/discovery/types';
import { Button } from '@/components/ui/button';
import { CheckCircle, Clock, AlertTriangle, Wrench, Car } from 'lucide-react';

interface VehicleHistoryProps {
  vehicle: Vehicle;
}

const VehicleHistory: React.FC<VehicleHistoryProps> = ({ vehicle }) => {
  // In a real app, this would be actual history data
  const mockHistoryEvents = [
    {
      date: "2022-10-15",
      type: "service",
      description: "Regular maintenance - Oil change, filter replacement, and general inspection",
      icon: <Wrench className="h-5 w-5 text-blue-500" />
    },
    {
      date: "2021-06-22",
      type: "ownership",
      description: "Vehicle ownership transferred to current owner",
      icon: <Car className="h-5 w-5 text-green-500" />
    },
    {
      date: "2020-11-08",
      type: "service",
      description: "Major service - Timing belt replacement, water pump, and coolant flush",
      icon: <Wrench className="h-5 w-5 text-blue-500" />
    },
    {
      date: "2019-03-17",
      type: "issue",
      description: "Minor accident reported - Front bumper damage repaired",
      icon: <AlertTriangle className="h-5 w-5 text-yellow-500" />
    }
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Vehicle History</CardTitle>
        <Button size="sm" variant="outline">Request Full History</Button>
      </CardHeader>
      <CardContent>
        {mockHistoryEvents.length > 0 ? (
          <div className="relative pl-6 border-l border-muted">
            {mockHistoryEvents.map((event, index) => (
              <div key={index} className="mb-8 relative">
                <span className="absolute -left-[29px] bg-background p-1">
                  {event.icon}
                </span>
                <div className="space-y-1">
                  <div className="flex items-center">
                    <span className="font-medium">{new Date(event.date).toLocaleDateString()}</span>
                    <span className="text-xs text-muted-foreground ml-2 uppercase">{event.type}</span>
                  </div>
                  <p className="text-sm">{event.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No History Available</h3>
            <p className="text-muted-foreground mb-4">
              There is no recorded history for this vehicle yet.
            </p>
            <Button variant="outline">Request History Check</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VehicleHistory;
