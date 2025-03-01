
import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
  Search, Car, Filter, Plus, Heart, Share, Info, MapPin, 
  Calendar, DollarSign, Clock, BarChart, Tag
} from 'lucide-react';

interface VehicleCardProps {
  vehicle: {
    id: number;
    make: string;
    model: string;
    year: number;
    price: number;
    mileage: number;
    image: string;
    location: string;
    added: string;
    tags: string[];
  };
}

const VehicleCard = ({ vehicle }: VehicleCardProps) => {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-muted relative overflow-hidden">
        <div className="absolute top-2 right-2 flex gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur-sm">
            <Heart className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur-sm">
            <Share className="h-4 w-4" />
          </Button>
        </div>
        <div className="absolute bottom-2 left-2">
          {vehicle.tags.map((tag, i) => (
            <Badge key={i} variant="secondary" className="mr-1 bg-background/80 backdrop-blur-sm">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-base">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </CardTitle>
            <div className="flex items-center text-sm text-muted-foreground mt-1">
              <MapPin className="h-3.5 w-3.5 mr-1" />
              <span>{vehicle.location}</span>
            </div>
          </div>
          <div className="font-semibold text-lg">
            ${vehicle.price.toLocaleString()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center">
            <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>{vehicle.mileage.toLocaleString()} miles</span>
          </div>
          <div className="flex items-center">
            <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
            <span>Added {vehicle.added}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-3">
        <Button variant="outline" size="sm" className="gap-1 mr-2">
          <Info className="h-4 w-4" />
          Details
        </Button>
        <Button size="sm" className="gap-1 ml-auto">
          <Plus className="h-4 w-4" />
          Add to Garage
        </Button>
      </CardFooter>
    </Card>
  );
};

const DiscoveredVehicles = () => {
  const [searchTerm, setSearchTerm] = useState("");
  
  const vehicles = [
    {
      id: 1,
      make: "Toyota",
      model: "Supra",
      year: 1998,
      price: 62500,
      mileage: 42000,
      image: "/placeholder.png",
      location: "Los Angeles, CA",
      added: "2 days ago",
      tags: ["Rare", "Sports Car"]
    },
    {
      id: 2,
      make: "Ford",
      model: "Mustang",
      year: 1967,
      price: 78900,
      mileage: 89000,
      image: "/placeholder.png",
      location: "Chicago, IL",
      added: "5 days ago",
      tags: ["Classic", "American"]
    },
    {
      id: 3,
      make: "Honda",
      model: "Civic Type R",
      year: 2021,
      price: 42000,
      mileage: 12000,
      image: "/placeholder.png",
      location: "Seattle, WA",
      added: "1 week ago",
      tags: ["Hot Hatch", "Modified"]
    },
    {
      id: 4,
      make: "Porsche",
      model: "911 Carrera",
      year: 2019,
      price: 110500,
      mileage: 18000,
      image: "/placeholder.png",
      location: "Miami, FL",
      added: "2 weeks ago",
      tags: ["Luxury", "Sports Car"]
    },
    {
      id: 5,
      make: "Chevrolet",
      model: "Corvette",
      year: 2020,
      price: 86000,
      mileage: 8500,
      image: "/placeholder.png",
      location: "Austin, TX",
      added: "3 days ago",
      tags: ["American", "Sports Car"]
    },
    {
      id: 6,
      make: "Nissan",
      model: "GT-R",
      year: 2017,
      price: 92000,
      mileage: 26000,
      image: "/placeholder.png",
      location: "Denver, CO",
      added: "6 days ago",
      tags: ["Japanese", "Performance"]
    }
  ];
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Discovered Vehicles</h1>
          <p className="text-muted-foreground">
            Browse vehicles discovered by our system and community
          </p>
        </div>
        
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search vehicles..." 
              className="pl-9" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex gap-2">
            <Select defaultValue="newest">
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="price-high">Price: High to Low</SelectItem>
                <SelectItem value="price-low">Price: Low to High</SelectItem>
              </SelectContent>
            </Select>
            
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </Button>
          </div>
        </div>
        
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all">All Vehicles</TabsTrigger>
            <TabsTrigger value="classic">Classic</TabsTrigger>
            <TabsTrigger value="sports">Sports Cars</TabsTrigger>
            <TabsTrigger value="modified">Modified</TabsTrigger>
            <TabsTrigger value="rare">Rare Finds</TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="m-0">
            <div className="flex justify-between items-center mb-4">
              <div className="text-sm text-muted-foreground">
                Showing <span className="font-medium">{vehicles.length}</span> discovered vehicles
              </div>
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <Car className="h-4 w-4 text-primary" />
                  <span>{vehicles.length} vehicles</span>
                </div>
                <div className="flex items-center gap-1">
                  <BarChart className="h-4 w-4 text-primary" />
                  <span>Market value: ${(1432500).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Tag className="h-4 w-4 text-primary" />
                  <span>12 categories</span>
                </div>
              </div>
            </div>
            
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles.map((vehicle) => (
                <VehicleCard key={vehicle.id} vehicle={vehicle} />
              ))}
            </div>
            
            <div className="mt-6 flex justify-center">
              <Button variant="outline">Load More Vehicles</Button>
            </div>
          </TabsContent>
          
          <TabsContent value="classic" className="m-0">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.year < 1990)
                .map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="sports" className="m-0">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.tags.includes("Sports Car"))
                .map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="modified" className="m-0">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.tags.includes("Modified"))
                .map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))
              }
            </div>
          </TabsContent>
          
          <TabsContent value="rare" className="m-0">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {vehicles
                .filter(v => v.tags.includes("Rare"))
                .map((vehicle) => (
                  <VehicleCard key={vehicle.id} vehicle={vehicle} />
                ))
              }
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default DiscoveredVehicles;
