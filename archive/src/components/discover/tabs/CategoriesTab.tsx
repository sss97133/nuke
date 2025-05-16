
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Car } from "lucide-react";

const CategoriesTab: React.FC = () => {
  return (
    <>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {[
          { title: "Classic Cars", count: 1243, icon: <Car /> },
          { title: "Muscle Cars", count: 876, icon: <Car /> },
          { title: "Exotic Supercars", count: 542, icon: <Car /> },
          { title: "Vintage Motorcycles", count: 421, icon: <Car /> },
          { title: "Electric Vehicles", count: 789, icon: <Car /> },
          { title: "Off-Road & 4x4", count: 653, icon: <Car /> },
          { title: "Luxury Sedans", count: 587, icon: <Car /> },
          { title: "Racing & Track Cars", count: 342, icon: <Car /> },
          { title: "Collectible Memorabilia", count: 1876, icon: <Car /> },
        ].map((category, i) => (
          <Card key={i} className="overflow-hidden hover:border-primary cursor-pointer transition-all">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-1">{category.title}</h3>
                <p className="text-sm text-muted-foreground">{category.count} listings</p>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                {category.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <h2 className="text-xl font-semibold mt-10 mb-4">Popular Tags</h2>
      <div className="flex flex-wrap gap-2">
        {[
          "Porsche", "Ferrari", "Ford Mustang", "Chevrolet", "BMW", "Mercedes-Benz", 
          "Lamborghini", "Audi", "Vintage", "Restoration", "Low Mileage", "Numbers Matching",
          "Convertible", "Limited Edition", "One Owner", "Documented History", "Garage Kept",
          "All Original", "Modified", "Rare Color", "Special Order", "Investment Grade",
          "Fully Restored", "Award Winner", "Matching Numbers", "Survivor"
        ].map((tag, i) => (
          <Button key={i} variant="outline" size="sm" className="rounded-full">
            {tag}
          </Button>
        ))}
      </div>
    </>
  );
};

export default CategoriesTab;
