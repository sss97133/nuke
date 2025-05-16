
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Compass, Filter } from "lucide-react";

const NearbyTab: React.FC = () => {
  return (
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card className="overflow-hidden">
          <div className="h-[500px] bg-muted flex items-center justify-center">
            <MapPin className="h-12 w-12 text-muted-foreground" />
            <span className="ml-2 text-muted-foreground text-lg">Interactive Map will be displayed here</span>
          </div>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              Displaying vehicle-related locations within 25 miles of your current location.
            </p>
          </CardContent>
        </Card>
      </div>
      
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Compass className="mr-2 h-5 w-5" />
              Nearby Locations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { name: "Classic Auto Gallery", type: "Dealership", distance: "2.3 miles" },
                { name: "Veteran Motors", type: "Service", distance: "4.1 miles" },
                { name: "AutoTech Specialists", type: "Parts", distance: "5.7 miles" },
                { name: "Cars & Coffee Meetup", type: "Event", distance: "7.2 miles" },
                { name: "Vintage Racing Club", type: "Community", distance: "8.5 miles" },
                { name: "MotorElegance Auctions", type: "Auction House", distance: "12.8 miles" },
              ].map((location, i) => (
                <div key={i} className="flex justify-between p-2 hover:bg-accent rounded cursor-pointer">
                  <div>
                    <div className="font-medium">{location.name}</div>
                    <div className="text-sm text-muted-foreground">{location.type}</div>
                  </div>
                  <div className="text-sm self-center">{location.distance}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Filter className="mr-2 h-5 w-5" />
              Filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label htmlFor="distance">Distance</Label>
                <Select defaultValue="25">
                  <SelectTrigger id="distance">
                    <SelectValue placeholder="Select distance" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 miles</SelectItem>
                    <SelectItem value="10">10 miles</SelectItem>
                    <SelectItem value="25">25 miles</SelectItem>
                    <SelectItem value="50">50 miles</SelectItem>
                    <SelectItem value="100">100 miles</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="type">Location Type</Label>
                <Select defaultValue="all">
                  <SelectTrigger id="type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="dealership">Dealerships</SelectItem>
                    <SelectItem value="service">Service Centers</SelectItem>
                    <SelectItem value="parts">Parts Suppliers</SelectItem>
                    <SelectItem value="events">Events</SelectItem>
                    <SelectItem value="community">Communities</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <Button variant="outline" className="w-full">
                Apply Filters
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default NearbyTab;
