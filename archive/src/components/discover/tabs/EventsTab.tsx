
import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, MapPin, Filter } from "lucide-react";

const EventsTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between mb-6">
        <h2 className="text-xl font-semibold">Upcoming Events</h2>
        <div className="flex gap-2">
          <Select defaultValue="upcoming">
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="popular">Most Popular</SelectItem>
              <SelectItem value="nearest">Nearest</SelectItem>
            </SelectContent>
          </Select>
          
          <Button variant="outline">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </div>
      </div>
      
      {[
        { 
          title: "Annual Concours d'Elegance", 
          date: "June 15-17, 2023", 
          location: "Pebble Beach, CA",
          description: "The premier celebration of automotive excellence featuring the world's most beautiful and rare automobiles.",
          attendees: 2500,
          interested: 342
        },
        { 
          title: "Motorcraft Auction Gala", 
          date: "July 8, 2023", 
          location: "Phoenix, AZ",
          description: "Exclusive auction event featuring rare classics and modern exotics with proceeds supporting automotive preservation.",
          attendees: 800,
          interested: 178
        },
        { 
          title: "Vintage Rally Championship", 
          date: "August 3-5, 2023", 
          location: "Portland, OR",
          description: "Three-day rally featuring pre-1980 vehicles competing across the stunning Pacific Northwest landscape.",
          attendees: 1200,
          interested: 230
        },
        { 
          title: "Future of Mobility Conference", 
          date: "September 12, 2023", 
          location: "Detroit, MI",
          description: "Industry leaders discuss emerging trends in electric vehicles, autonomous driving, and sustainable transportation.",
          attendees: 1800,
          interested: 412
        },
      ].map((event, i) => (
        <Card key={i} className="overflow-hidden">
          <div className="md:flex">
            <div className="md:w-1/4 bg-muted h-40 md:h-auto flex items-center justify-center flex-shrink-0">
              <Calendar className="h-12 w-12 text-muted-foreground" />
            </div>
            <div className="p-6 md:w-3/4">
              <h3 className="text-xl font-semibold mb-2">{event.title}</h3>
              <div className="flex flex-wrap gap-y-2 mb-3">
                <div className="flex items-center mr-4">
                  <Calendar className="h-4 w-4 mr-1 text-muted-foreground" />
                  <span className="text-sm">{event.date}</span>
                </div>
                <div className="flex items-center">
                  <MapPin className="h-4 w-4 mr-1 text-muted-foreground" />
                  <span className="text-sm">{event.location}</span>
                </div>
              </div>
              <p className="text-muted-foreground mb-4">{event.description}</p>
              <div className="flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                  <span>{event.attendees} attending</span>
                  <span className="mx-2">•</span>
                  <span>{event.interested} interested</span>
                </div>
                <div className="space-x-2">
                  <Button variant="outline" size="sm">Interested</Button>
                  <Button size="sm">Register</Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default EventsTab;
