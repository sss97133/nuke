
import React from 'react';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';

interface ClassificationSectionProps {
  form: UseFormReturn<VehicleFormValues>;
}

export const ClassificationSection: React.FC<ClassificationSectionProps> = ({ form }) => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Vehicle Classification</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="body_style"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Body Style</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select body style" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="sedan">Sedan</SelectItem>
                      <SelectItem value="coupe">Coupe</SelectItem>
                      <SelectItem value="hatchback">Hatchback</SelectItem>
                      <SelectItem value="suv">SUV</SelectItem>
                      <SelectItem value="crossover">Crossover</SelectItem>
                      <SelectItem value="convertible">Convertible</SelectItem>
                      <SelectItem value="wagon">Station Wagon</SelectItem>
                      <SelectItem value="pickup">Pickup Truck</SelectItem>
                      <SelectItem value="van">Van</SelectItem>
                      <SelectItem value="minivan">Minivan</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fuel_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fuel Type</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select fuel type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="gasoline">Gasoline</SelectItem>
                      <SelectItem value="diesel">Diesel</SelectItem>
                      <SelectItem value="electric">Electric</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                      <SelectItem value="plugin_hybrid">Plug-in Hybrid</SelectItem>
                      <SelectItem value="natural_gas">Natural Gas</SelectItem>
                      <SelectItem value="hydrogen">Hydrogen</SelectItem>
                      <SelectItem value="flex_fuel">Flex Fuel</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="transmission"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Transmission Type</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select transmission" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="automatic">Automatic</SelectItem>
                      <SelectItem value="cvt">CVT</SelectItem>
                      <SelectItem value="semi_automatic">Semi-Automatic</SelectItem>
                      <SelectItem value="dual_clutch">Dual Clutch</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="drivetrain"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Drivetrain</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select drivetrain" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="fwd">Front-Wheel Drive (FWD)</SelectItem>
                      <SelectItem value="rwd">Rear-Wheel Drive (RWD)</SelectItem>
                      <SelectItem value="awd">All-Wheel Drive (AWD)</SelectItem>
                      <SelectItem value="4wd">Four-Wheel Drive (4WD)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="engine_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Engine Type</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. V8, Inline-4, Electric" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="number_of_doors"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Number of Doors</FormLabel>
                  <FormControl>
                    <Input type="number" min="1" max="7" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="number_of_seats"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Number of Seats</FormLabel>
                  <FormControl>
                    <Input type="number" min="1" max="12" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="weight"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Weight (kg)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Vehicle weight in kg" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="top_speed"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Top Speed (km/h)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Top speed in km/h" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
