
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Search, Loader2, Link as LinkIcon, ExternalLink, Car, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const formSchema = z.object({
  make: z.string().min(1, { message: "Make is required" }),
  model: z.string().min(1, { message: "Model is required" }),
  year: z.coerce.number()
    .min(1900, { message: "Year must be at least 1900" })
    .max(new Date().getFullYear() + 1, { message: "Year cannot be in the future" }),
  price: z.string().optional(),
  vin: z.string().optional(),
  source: z.string().min(1, { message: "Source is required" }),
  source_url: z.string().url({ message: "Must be a valid URL" }).optional(),
  notes: z.string().optional(),
  location: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface DiscoveredVehicle {
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
  status: string;
  created_at: string;
}

export const DiscoveredVehicles = () => {
  const { session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddingVehicle, setIsAddingVehicle] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      make: "",
      model: "",
      year: new Date().getFullYear(),
      price: "",
      vin: "",
      source: "",
      source_url: "",
      notes: "",
      location: "",
    },
  });

  const { data: discoveredVehicles, isLoading } = useQuery({
    queryKey: ['discovered-vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovered_vehicles')
        .select('*')
        .eq('user_id', session?.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as DiscoveredVehicle[];
    },
    enabled: !!session,
  });

  const addVehicleMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { data, error } = await supabase
        .from('discovered_vehicles')
        .insert([
          {
            ...values,
            user_id: session?.user.id,
            status: 'unverified',
          },
        ])
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Vehicle added",
        description: "Your discovered vehicle has been added to your collection.",
      });
      queryClient.invalidateQueries({ queryKey: ['discovered-vehicles'] });
      reset();
      setIsAddingVehicle(false);
    },
    onError: (error) => {
      toast({
        title: "Failed to add vehicle",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: FormValues) => {
    addVehicleMutation.mutate(values);
  };

  const filteredVehicles = discoveredVehicles?.filter(vehicle => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      vehicle.make.toLowerCase().includes(query) ||
      vehicle.model.toLowerCase().includes(query) ||
      vehicle.year.toString().includes(query) ||
      (vehicle.vin && vehicle.vin.toLowerCase().includes(query))
    );
  });

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Discovered Vehicles</h1>
          <p className="text-muted-foreground">
            Track vehicles you've discovered online or in the real world
          </p>
        </div>
        {!isAddingVehicle && (
          <Button onClick={() => setIsAddingVehicle(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Discovery
          </Button>
        )}
      </div>

      <Tabs defaultValue="list" className="space-y-6">
        <TabsList>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="grid">Grid View</TabsTrigger>
        </TabsList>

        <div className="flex mb-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search discoveries..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {isAddingVehicle && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Add a Discovered Vehicle</CardTitle>
              <CardDescription>
                Add details about a vehicle you found online or in person
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit(onSubmit)}>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="make">Make</Label>
                    <Input id="make" {...register("make")} placeholder="e.g. Ford" />
                    {errors.make && (
                      <p className="text-sm text-red-500">{errors.make.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <Input id="model" {...register("model")} placeholder="e.g. Mustang" />
                    {errors.model && (
                      <p className="text-sm text-red-500">{errors.model.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="year">Year</Label>
                    <Input
                      id="year"
                      type="number"
                      {...register("year")}
                      placeholder="e.g. 1965"
                    />
                    {errors.year && (
                      <p className="text-sm text-red-500">{errors.year.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="price">Price (if listed)</Label>
                    <Input
                      id="price"
                      {...register("price")}
                      placeholder="e.g. $15,000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vin">VIN (if available)</Label>
                    <Input
                      id="vin"
                      {...register("vin")}
                      placeholder="Vehicle Identification Number"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="source">Source</Label>
                    <Input
                      id="source"
                      {...register("source")}
                      placeholder="e.g. Craigslist, Facebook Marketplace, In-person"
                    />
                    {errors.source && (
                      <p className="text-sm text-red-500">{errors.source.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source_url">Source URL (if online)</Label>
                    <Input
                      id="source_url"
                      {...register("source_url")}
                      placeholder="https://"
                    />
                    {errors.source_url && (
                      <p className="text-sm text-red-500">{errors.source_url.message}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    {...register("location")}
                    placeholder="e.g. Seattle, WA"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    {...register("notes")}
                    placeholder="Add any additional details about this vehicle"
                    rows={3}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddingVehicle(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Discovery"
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        <TabsContent value="list" className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredVehicles?.length === 0 ? (
            <div className="text-center py-8">
              <Car className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
              <h3 className="mt-4 text-lg font-medium">No vehicles discovered yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Add your first vehicle discovery to start building your collection
              </p>
              {!isAddingVehicle && (
                <Button
                  onClick={() => setIsAddingVehicle(true)}
                  className="mt-4"
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add Your First Discovery
                </Button>
              )}
            </div>
          ) : (
            filteredVehicles?.map((vehicle) => (
              <Card key={vehicle.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="p-6">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </h3>
                        <div className="flex items-center text-sm text-muted-foreground mt-1">
                          <span className="flex items-center">
                            <LinkIcon className="mr-1 h-3 w-3" /> 
                            {vehicle.source}
                          </span>
                          {vehicle.location && (
                            <span className="flex items-center ml-4">
                              <MapPin className="mr-1 h-3 w-3" /> 
                              {vehicle.location}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2 sm:mt-0">
                        {vehicle.price && (
                          <span className="font-medium">{vehicle.price}</span>
                        )}
                        <Badge variant="secondary">
                          {vehicle.status === "unverified" ? "Unverified" : "Verified"}
                        </Badge>
                      </div>
                    </div>
                    {vehicle.notes && (
                      <>
                        <Separator className="my-4" />
                        <p className="text-sm">{vehicle.notes}</p>
                      </>
                    )}
                  </div>
                  {vehicle.source_url && (
                    <div className="bg-muted px-6 py-3 flex justify-end">
                      <Button variant="ghost" size="sm" asChild>
                        <a 
                          href={vehicle.source_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center"
                        >
                          View Source <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="grid">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredVehicles?.length === 0 ? (
            <div className="text-center py-8">
              <Car className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
              <h3 className="mt-4 text-lg font-medium">No vehicles discovered yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Add your first vehicle discovery to start building your collection
              </p>
              {!isAddingVehicle && (
                <Button
                  onClick={() => setIsAddingVehicle(true)}
                  className="mt-4"
                >
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add Your First Discovery
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredVehicles?.map((vehicle) => (
                <Card key={vehicle.id} className="overflow-hidden">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-base">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </CardTitle>
                    <CardDescription className="text-xs flex items-center">
                      <LinkIcon className="mr-1 h-3 w-3" /> 
                      {vehicle.source}
                      {vehicle.location && (
                        <span className="flex items-center ml-2">
                          <MapPin className="mr-1 h-3 w-3" /> 
                          {vehicle.location}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    {vehicle.notes ? (
                      <p className="text-sm line-clamp-2">{vehicle.notes}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No additional notes</p>
                    )}
                  </CardContent>
                  <CardFooter className="flex justify-between items-center p-4 bg-muted/50">
                    <div className="flex items-center gap-2">
                      {vehicle.price && (
                        <span className="text-sm font-medium">{vehicle.price}</span>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {vehicle.status === "unverified" ? "Unverified" : "Verified"}
                      </Badge>
                    </div>
                    {vehicle.source_url && (
                      <Button variant="ghost" size="sm" className="h-8" asChild>
                        <a 
                          href={vehicle.source_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center text-xs"
                        >
                          View <ExternalLink className="ml-1 h-3 w-3" />
                        </a>
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};
