import type { Database } from '../types';
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Table, 
  TableBody, 
  TableCaption, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Car, 
  Plus, 
  Link as LinkIcon, 
  MapPin, 
  Clock, 
  Tag, 
  FileText,
  Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type DiscoveredVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  price?: string;
  vin?: string;
  source: string;
  source_url?: string;
  notes?: string;
  location?: string;
  status: 'verified' | 'unverified';
  created_at: string;
  updated_at: string;
};

export const DiscoveredVehiclesList = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newVehicle, setNewVehicle] = useState({
    make: "",
    model: "",
    year: new Date().getFullYear(),
    price: "",
    vin: "",
    source: "",
    source_url: "",
    notes: "",
    location: ""
  });

  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ['discovered-vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('discovered_vehicles')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error("Error fetching discovered vehicles:", error);
        throw error;
      }
      
      return data as DiscoveredVehicle[];
    }
  });

  const addVehicleMutation = useMutation({
    mutationFn: async (vehicleData: Omit<DiscoveredVehicle, 'id' | 'created_at' | 'updated_at' | 'status'> & { user_id: string }) => {
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        
        .insert([vehicleData])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovered-vehicles'] });
      setIsAddDialogOpen(false);
      setNewVehicle({
        make: "",
        model: "",
        year: new Date().getFullYear(),
        price: "",
        vin: "",
        source: "",
        source_url: "",
        notes: "",
        location: ""
      });
      toast({
        title: "Vehicle Added",
        description: "The vehicle has been added to your discoveries.",
      });
    },
    onError: (error) => {
      console.error("Error adding vehicle:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add the vehicle. Please try again."
      });
    }
  });

  const deleteVehicleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
  if (error) console.error("Database query error:", error);
        
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ['discovered-vehicles'] });
      toast({
        title: "Vehicle Removed",
        description: "The vehicle has been removed from your discoveries.",
      });
    },
    onError: (error) => {
      console.error("Error deleting vehicle:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete the vehicle. Please try again."
      });
    }
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewVehicle(prev => ({
      ...prev,
      [name]: name === 'year' ? parseInt(value) || new Date().getFullYear() : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data: userData } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      
      if (!userData?.user) {
        throw new Error("User not authenticated");
      }
      
      const vehicleData = {
        ...newVehicle,
        user_id: userData.user.id,
        status: 'unverified' as const
      };
      
      addVehicleMutation.mutate(vehicleData);
    } catch (error) {
      console.error("Authentication error:", error);
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "Please log in to add vehicles."
      });
    }
  };

  if (error) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Discovered Vehicles</CardTitle>
          <CardDescription>Vehicles you've discovered online or in the real world</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-6 text-muted-foreground">
            <p>Error loading discovered vehicles. Please try again later.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="container mx-auto px-4">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">Discovered Vehicles</CardTitle>
              <CardDescription>Vehicles you've discovered online or in the real world</CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus size={16} />
                  <span>Add Discovery</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <form onSubmit={handleSubmit}>
                  <DialogHeader>
                    <DialogTitle>Add Discovered Vehicle</DialogTitle>
                    <DialogDescription>
                      Enter details about the vehicle you've discovered.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-1">
                        <Label htmlFor="make">Make</Label>
                        <Input
                          id="make"
                          name="make"
                          value={newVehicle.make}
                          onChange={handleInputChange}
                          required
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="model">Model</Label>
                        <Input
                          id="model"
                          name="model"
                          value={newVehicle.model}
                          onChange={handleInputChange}
                          required
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="year">Year</Label>
                        <Input
                          id="year"
                          name="year"
                          type="number"
                          value={newVehicle.year}
                          onChange={handleInputChange}
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="price">Price (if listed)</Label>
                      <Input
                        id="price"
                        name="price"
                        value={newVehicle.price}
                        onChange={handleInputChange}
                        placeholder="e.g. $5,000"
                      />
                    </div>

                    <div>
                      <Label htmlFor="vin">VIN (if available)</Label>
                      <Input
                        id="vin"
                        name="vin"
                        value={newVehicle.vin}
                        onChange={handleInputChange}
                      />
                    </div>

                    <div>
                      <Label htmlFor="source">Source</Label>
                      <Input
                        id="source"
                        name="source"
                        value={newVehicle.source}
                        onChange={handleInputChange}
                        placeholder="e.g. Craigslist, Facebook Marketplace, In-person"
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="source_url">Source URL</Label>
                      <Input
                        id="source_url"
                        name="source_url"
                        value={newVehicle.source_url}
                        onChange={handleInputChange}
                        placeholder="https://"
                      />
                    </div>

                    <div>
                      <Label htmlFor="location">Location</Label>
                      <Input
                        id="location"
                        name="location"
                        value={newVehicle.location}
                        onChange={handleInputChange}
                        placeholder="e.g. Seattle, WA"
                      />
                    </div>

                    <div>
                      <Label htmlFor="notes">Notes</Label>
                      <Textarea
                        id="notes"
                        name="notes"
                        value={newVehicle.notes}
                        onChange={handleInputChange}
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button 
                      variant="outline" 
                      type="button" 
                      onClick={() => setIsAddDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={addVehicleMutation.isPending}>
                      {addVehicleMutation.isPending ? "Adding..." : "Add Vehicle"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : vehicles && vehicles.length > 0 ? (
            <Table>
              <TableCaption>Your discovered vehicles</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Discovered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{vehicle.year} {vehicle.make} {vehicle.model}</span>
                        {vehicle.vin && <span className="text-xs text-muted-foreground">VIN: {vehicle.vin}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{vehicle.source}</span>
                        {vehicle.source_url && (
                          <a
                            href={vehicle.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                          >
                            <LinkIcon size={12} />
                            <span>View listing</span>
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{vehicle.price || "Not listed"}</TableCell>
                    <TableCell>
                      {vehicle.location ? (
                        <div className="flex items-center gap-1">
                          <MapPin size={14} />
                          <span>{vehicle.location}</span>
                        </div>
                      ) : (
                        "Unknown"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={vehicle.status === 'verified' ? 'default' : 'secondary'}
                      >
                        {vehicle.status === 'verified' ? 'Verified' : 'Unverified'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock size={14} />
                        {new Date(vehicle.created_at).toLocaleDateString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {vehicle.notes && (
                          <Button 
                            variant="ghost" 
                            size="icon"
                            title="View notes"
                          >
                            <FileText size={16} />
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon"
                          title="Delete"
                          onClick={() => {
                            if (confirm("Are you sure you want to delete this vehicle?")) {
                              deleteVehicleMutation.mutate(vehicle.id);
                            }
                          }}
                        >
                          <Trash2 size={16} className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <Car size={48} className="text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No discovered vehicles yet</h3>
              <p className="text-muted-foreground mb-4">
                Start tracking interesting vehicles you find online or in the wild.
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                Add Your First Discovery
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
