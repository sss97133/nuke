import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlusCircle, Car, Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';

// Mock data for demonstration purposes
const MOCK_VEHICLES = [
  {
    id: '1',
    make: 'Ford',
    model: 'Mustang',
    year: 1967,
    color: 'Blue',
    ownership_status: 'owned',
    image: null,
    lastUpdated: '2025-02-15T14:30:00Z'
  },
  {
    id: '2',
    make: 'Chevrolet',
    model: 'Corvette',
    year: 1963,
    color: 'Red',
    ownership_status: 'claimed',
    image: null,
    lastUpdated: '2025-03-01T10:15:00Z'
  },
  {
    id: '3',
    make: 'Porsche',
    model: '911',
    year: 1973,
    color: 'Silver',
    ownership_status: 'discovered',
    image: null,
    lastUpdated: '2025-02-28T16:45:00Z'
  }
];

export default function Vehicles() {
  const [searchQuery, setSearchQuery] = useState('');
  const [vehicles] = useState(MOCK_VEHICLES);
  const navigate = useNavigate();
  
  // Filter vehicles based on search query
  const filteredVehicles = vehicles.filter(vehicle => {
    const searchString = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.color}`.toLowerCase();
    return searchString.includes(searchQuery.toLowerCase());
  });
  
  const getOwnershipStatusBadge = (status: string) => {
    switch (status) {
      case 'owned':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Owned</span>;
      case 'claimed':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300">Claimed</span>;
      case 'discovered':
        return <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">Discovered</span>;
      default:
        return null;
    }
  };

  return (
    <div className="container py-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Vehicles</h1>
          <p className="text-muted-foreground mt-1">
            Manage and view all your vehicles
          </p>
        </div>
        <Button 
          onClick={() => navigate('/add-vehicle')}
          className="whitespace-nowrap"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Vehicle
        </Button>
      </div>
      
      <div className="flex flex-col sm:flex-row justify-between gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vehicles..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button variant="outline" className="sm:w-auto w-full">
          <Filter className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </div>
      
      {filteredVehicles.length === 0 ? (
        <div className="text-center py-12">
          <Car className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
          <h3 className="mt-4 text-lg font-medium">No vehicles found</h3>
          <p className="mt-1 text-muted-foreground">
            {searchQuery 
              ? "Try adjusting your search query" 
              : "Add your first vehicle to get started"}
          </p>
          <Button 
            onClick={() => navigate('/add-vehicle')} 
            className="mt-6"
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Vehicle
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredVehicles.map((vehicle) => (
            <Card key={vehicle.id} className="overflow-hidden">
              <div className="aspect-video bg-muted flex items-center justify-center">
                <Car className="h-12 w-12 text-muted-foreground opacity-50" />
              </div>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-xl">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </CardTitle>
                  {getOwnershipStatusBadge(vehicle.ownership_status)}
                </div>
              </CardHeader>
              <CardContent className="pb-2">
                <div className="text-sm text-muted-foreground">
                  <p>Color: {vehicle.color}</p>
                  <p className="mt-1">
                    Last updated {new Date(vehicle.lastUpdated).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
              <CardFooter className="pt-0 flex justify-between">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/vehicles/${vehicle.id}`}>View Details</Link>
                </Button>
                <Button variant="outline" size="sm">Edit</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
