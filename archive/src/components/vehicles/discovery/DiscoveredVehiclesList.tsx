import type { Database } from '@/types/database';
import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams, useNavigate } from "react-router-dom";
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

type Vehicle = Database['public']['Tables']['vehicles']['Row'];
type NewVehicle = Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>;

export const DiscoveredVehiclesList = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  // Initialize vehicle state from URL parameters
  const [newVehicle, setNewVehicle] = useState<NewVehicle>({
    make: searchParams.get('make') || "",
    model: searchParams.get('model') || "",
    year: parseInt(searchParams.get('year') || String(new Date().getFullYear())),
    vin: searchParams.get('vin') || "",
    notes: searchParams.get('notes') || "",
    current_value: parseInt(searchParams.get('purchase_price') || "0"),
    status: "discovered",
    trim: searchParams.get('trim') || undefined,
    color: searchParams.get('color') || undefined,
    mileage: parseInt(searchParams.get('mileage') || "0") || undefined,
    engine_type: searchParams.get('engine_type') || undefined,
    purchase_date: searchParams.get('purchase_date') || undefined,
    purchase_location: searchParams.get('purchase_location') || undefined,
    doors: parseInt(searchParams.get('doors') || "0") || undefined,
    seats: parseInt(searchParams.get('seats') || "0") || undefined,
    weight: parseInt(searchParams.get('weight') || "0") || undefined,
    top_speed: parseInt(searchParams.get('top_speed') || "0") || undefined,
    tags: searchParams.get('tags')?.split(',').filter(Boolean) || undefined
  });

  // Open dialog if URL parameters are present
  useEffect(() => {
    if (searchParams.toString()) {
      setIsAddDialogOpen(true);
      // Clear URL parameters after reading them
      navigate('/discovered-vehicles', { replace: true });
    }
  }, [searchParams, navigate]);

  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ['discovered-vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select(`
          id,
          make,
          model,
          year,
          vin,
          notes,
          current_value,
          status,
          user_id,
          created_at,
          updated_at
        `)
        .eq('status', 'discovered')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error("Error fetching vehicles:", error);
        throw error;
      }
      
      return data as Vehicle[];
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30000
  });

  const addVehicleMutation = useMutation({
    mutationFn: async (vehicleData: Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['discovered-vehicles'] });
      setIsAddDialogOpen(false);
      setNewVehicle({
        make: "",
        model: "",
        year: new Date().getFullYear(),
        vin: "",
        notes: "",
        current_value: 0,
        status: "discovered",
        trim: undefined,
        color: undefined,
        mileage: undefined,
        engine_type: undefined,
        purchase_date: undefined,
        purchase_location: undefined,
        doors: undefined,
        seats: undefined,
        weight: undefined,
        top_speed: undefined,
        tags: undefined
      });
      toast({
        title: "Vehicle Added",
        description: "The vehicle has been added to your discoveries.",
      });
      // Navigate to the vehicle profile page
      navigate(`/vehicles/${data.id}`);
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
        .from('vehicles')
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
      if (!userData?.user) {
        throw new Error("User not authenticated");
      }
      
      const vehicleData = {
        ...newVehicle,
        user_id: userData.user.id,
        status: 'discovered' as const,
        // Add additional fields from URL parameters if needed
        trim: searchParams.get('trim') || undefined,
        color: searchParams.get('color') || undefined,
        mileage: parseInt(searchParams.get('mileage') || "0") || undefined,
        engine_type: searchParams.get('engine_type') || undefined,
        purchase_date: searchParams.get('purchase_date') || undefined,
        purchase_location: searchParams.get('purchase_location') || undefined
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
          <CardDescription>Vehicles you&apos;ve discovered online or in the real world</CardDescription>
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
              <CardDescription>Vehicles you&apos;ve discovered and added to your collection</CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus size={16} />
                  <span>Add Vehicle</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <form onSubmit={handleSubmit}>
                  <DialogHeader>
                    <DialogTitle>Add New Vehicle</DialogTitle>
                    <DialogDescription>
                      Enter details about the vehicle you want to add.
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
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-1">
                        <Label htmlFor="trim">Trim</Label>
                        <Input
                          id="trim"
                          name="trim"
                          value={newVehicle.trim || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="color">Color</Label>
                        <Input
                          id="color"
                          name="color"
                          value={newVehicle.color || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-1">
                        <Label htmlFor="vin">VIN</Label>
                        <Input
                          id="vin"
                          name="vin"
                          value={newVehicle.vin}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="current_value">Value</Label>
                        <Input
                          id="current_value"
                          name="current_value"
                          type="number"
                          value={newVehicle.current_value}
                          onChange={handleInputChange}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-1">
                        <Label htmlFor="mileage">Mileage</Label>
                        <Input
                          id="mileage"
                          name="mileage"
                          type="number"
                          value={newVehicle.mileage || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="engine_type">Engine Type</Label>
                        <Input
                          id="engine_type"
                          name="engine_type"
                          value={newVehicle.engine_type || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-1">
                        <Label htmlFor="purchase_date">Purchase Date</Label>
                        <Input
                          id="purchase_date"
                          name="purchase_date"
                          type="date"
                          value={newVehicle.purchase_date || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="purchase_location">Purchase Location</Label>
                        <Input
                          id="purchase_location"
                          name="purchase_location"
                          value={newVehicle.purchase_location || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-1">
                        <Label htmlFor="doors">Doors</Label>
                        <Input
                          id="doors"
                          name="doors"
                          type="number"
                          value={newVehicle.doors || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="seats">Seats</Label>
                        <Input
                          id="seats"
                          name="seats"
                          type="number"
                          value={newVehicle.seats || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="weight">Weight (lbs)</Label>
                        <Input
                          id="weight"
                          name="weight"
                          type="number"
                          value={newVehicle.weight || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-1">
                        <Label htmlFor="top_speed">Top Speed (mph)</Label>
                        <Input
                          id="top_speed"
                          name="top_speed"
                          type="number"
                          value={newVehicle.top_speed || ''}
                          onChange={handleInputChange}
                        />
                      </div>
                      <div className="col-span-1">
                        <Label htmlFor="tags">Tags</Label>
                        <Input
                          id="tags"
                          name="tags"
                          value={Array.isArray(newVehicle.tags) ? newVehicle.tags.join(', ') : ''}
                          onChange={(e) => setNewVehicle(prev => ({
                            ...prev,
                            tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean)
                          }))}
                          placeholder="Comma-separated tags"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1">
                      <Label htmlFor="notes">Notes</Label>
                      <Textarea
                        id="notes"
                        name="notes"
                        value={newVehicle.notes}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="submit">Add Vehicle</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-6">
              <p>Loading vehicles...</p>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center p-6 text-destructive">
              <p>Error loading vehicles. Please try again later.</p>
            </div>
          ) : !vehicles?.length ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <p>No vehicles discovered yet. Add your first vehicle to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>VIN</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell>{vehicle.make} {vehicle.model}</TableCell>
                    <TableCell>{vehicle.year}</TableCell>
                    <TableCell>{vehicle.vin || 'N/A'}</TableCell>
                    <TableCell>
                      {vehicle.current_value 
                        ? new Intl.NumberFormat('en-US', { 
                            style: 'currency', 
                            currency: 'USD' 
                          }).format(vehicle.current_value)
                        : 'N/A'
                      }
                    </TableCell>
                    <TableCell>
                      <Badge variant={vehicle.status === 'discovered' ? 'secondary' : 'default'}>
                        {vehicle.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteVehicleMutation.mutate(vehicle.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
