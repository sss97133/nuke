
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Users, Clock, Car } from "lucide-react";
import FeaturedListings from "../FeaturedListings";

const TrendingTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center">
              <TrendingUp className="mr-2 h-5 w-5" />
              Market Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                "Classic car prices up 12% in Q2 2023",
                "Electric vehicles seeing increased demand",
                "SUV market stabilizing after 2 years of growth",
                "Rare vehicle auctions breaking records"
              ].map((trend, i) => (
                <div key={i} className="flex items-center p-2 hover:bg-accent rounded cursor-pointer">
                  <span className="font-medium text-sm">{trend}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center">
              <Users className="mr-2 h-5 w-5" />
              Community Picks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                "Top 5 undervalued classics to watch",
                "Community spotlight: Restoration projects",
                "Most viewed vehicles this month",
                "Rising stars: New collectors to follow"
              ].map((pick, i) => (
                <div key={i} className="flex items-center p-2 hover:bg-accent rounded cursor-pointer">
                  <span className="font-medium text-sm">{pick}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center">
              <Clock className="mr-2 h-5 w-5" />
              Recent Discoveries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                "Barn find: 1967 Shelby GT500",
                "Rare Ferrari discovered in private collection",
                "Limited production BMW M1 surfaces in Japan",
                "Original-owner Porsche 356 with all documentation"
              ].map((discovery, i) => (
                <div key={i} className="flex items-center p-2 hover:bg-accent rounded cursor-pointer">
                  <span className="font-medium text-sm">{discovery}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <FeaturedListings />
    </div>
  );
};

export default TrendingTab;
