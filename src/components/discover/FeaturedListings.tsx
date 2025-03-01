
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Car } from "lucide-react";

const FeaturedListings: React.FC = () => {
  return (
    <>
      <h2 className="text-xl font-semibold mt-10 mb-4">Featured Listings</h2>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {[
          { title: "1970 Porsche 911S", price: "$135,000", location: "Los Angeles, CA", days: 3, bids: 18 },
          { title: "1965 Shelby Cobra", price: "$875,000", location: "Miami, FL", days: 5, bids: 24 },
          { title: "1990 Mercedes 300SL", price: "$42,500", location: "Chicago, IL", days: 2, bids: 11 },
          { title: "2005 Ford GT", price: "$395,000", location: "Seattle, WA", days: 4, bids: 21 },
          { title: "1967 Toyota 2000GT", price: "$900,000", location: "New York, NY", days: 6, bids: 32 },
          { title: "1985 Ferrari 288 GTO", price: "$3,200,000", location: "Dallas, TX", days: 7, bids: 28 },
        ].map((listing, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="h-40 bg-muted flex items-center justify-center">
              <Car className="h-12 w-12 text-muted-foreground" />
            </div>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{listing.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-center">
                <span className="font-semibold">{listing.price}</span>
                <span className="text-sm text-muted-foreground">{listing.location}</span>
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                <span>{listing.days} days left</span>
                <span className="mx-2">•</span>
                <span>{listing.bids} bids</span>
              </div>
              <Button variant="outline" className="w-full mt-4">View Details</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
};

export default FeaturedListings;
