
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';
import { MarketplaceListing } from '../hooks/useMarketplaceListing';

interface MarketplaceListingDetailsProps {
  listing: MarketplaceListing;
}

const MarketplaceListingDetails: React.FC<MarketplaceListingDetailsProps> = ({ 
  listing 
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Listing Details</CardTitle>
      </CardHeader>
      
      <CardContent>
        <Tabs defaultValue="description">
          <TabsList className="mb-4">
            <TabsTrigger value="description">Description</TabsTrigger>
            <TabsTrigger value="specs">Vehicle Specs</TabsTrigger>
          </TabsList>
          
          <TabsContent value="description" className="space-y-4">
            <div className="whitespace-pre-line">
              {listing.description}
            </div>
            
            <Separator />
            
            <div>
              <h4 className="font-medium mb-2">Key Details</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">Year:</span>{" "}
                  <span className="font-medium">{listing.vehicle.year}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Make:</span>{" "}
                  <span className="font-medium">{listing.vehicle.make}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Model:</span>{" "}
                  <span className="font-medium">{listing.vehicle.model}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Mileage:</span>{" "}
                  <span className="font-medium">{listing.vehicle.mileage.toLocaleString()} miles</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Listed:</span>{" "}
                  <span className="font-medium">{format(new Date(listing.created_at), 'MMM d, yyyy')}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Condition:</span>{" "}
                  <span className="font-medium">{listing.condition}</span>
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="specs" className="space-y-4">
            <h4 className="font-medium mb-2">Vehicle Specifications</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="text-sm">
                <span className="text-muted-foreground">VIN:</span>{" "}
                <span className="font-medium">{listing.vehicle.vin || 'Not provided'}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Engine:</span>{" "}
                <span className="font-medium">{listing.vehicle.engine || 'Not provided'}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Transmission:</span>{" "}
                <span className="font-medium">{listing.vehicle.transmission || 'Not provided'}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Drivetrain:</span>{" "}
                <span className="font-medium">{listing.specifications?.drivetrain || 'Not provided'}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Exterior Color:</span>{" "}
                <span className="font-medium">{listing.vehicle.exterior_color || 'Not provided'}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Interior Color:</span>{" "}
                <span className="font-medium">{listing.vehicle.interior_color || 'Not provided'}</span>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <h4 className="font-medium mb-2">Features</h4>
              <div className="flex flex-wrap gap-2">
                {listing.features && listing.features.length > 0 ? (
                  listing.features.map((feature, index) => (
                    <Badge key={index} variant="outline">{feature}</Badge>
                  ))
                ) : (
                  <>
                    <Badge variant="outline">Bluetooth</Badge>
                    <Badge variant="outline">Navigation</Badge>
                    <Badge variant="outline">Backup Camera</Badge>
                    <Badge variant="outline">Leather Seats</Badge>
                    <Badge variant="outline">Heated Seats</Badge>
                    <Badge variant="outline">Sunroof</Badge>
                  </>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default MarketplaceListingDetails;
