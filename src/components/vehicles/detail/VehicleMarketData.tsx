
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Vehicle } from '@/components/vehicles/discovery/types';
import { Separator } from "@/components/ui/separator";
import { ArrowDownRight, ArrowRight, ArrowUpRight, DollarSign, BarChart3, TrendingUp } from 'lucide-react';

interface VehicleMarketDataProps {
  vehicle: Vehicle;
}

const VehicleMarketData: React.FC<VehicleMarketDataProps> = ({ vehicle }) => {
  // In a real app, this would be actual market data
  const mockPriceHistory = [56000, 58500, 61000, 64000, 65000];
  const mockSimilarSales = [59500, 67200, 63800, 62000, 68500];
  
  const trendIcon = vehicle.price_trend === 'up' 
    ? <ArrowUpRight className="h-5 w-5 text-green-500" />
    : vehicle.price_trend === 'down'
    ? <ArrowDownRight className="h-5 w-5 text-red-500" />
    : <ArrowRight className="h-5 w-5 text-yellow-500" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none shadow-none bg-muted/50">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Current Market Value</p>
                  <p className="text-2xl font-bold">${vehicle.market_value?.toLocaleString()}</p>
                </div>
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-none bg-muted/50">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Market Trend</p>
                  <div className="flex items-center">
                    <p className="text-2xl font-bold mr-2">
                      {vehicle.price_trend === 'up' ? 'Rising'
                        : vehicle.price_trend === 'down' ? 'Falling'
                        : 'Stable'}
                    </p>
                    {trendIcon}
                  </div>
                </div>
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-none bg-muted/50">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Parts Availability</p>
                  <p className="text-2xl font-bold">Medium</p>
                </div>
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Separator />

        <div>
          <h3 className="font-medium text-lg mb-4">Market Trends</h3>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Price History (Last 6 Months)</p>
              <div className="h-20 bg-muted rounded-md flex items-end p-2">
                {mockPriceHistory.map((price, index) => {
                  const height = (price / Math.max(...mockPriceHistory)) * 100;
                  return (
                    <div key={index} className="flex-1 flex flex-col items-center">
                      <div 
                        className="w-full max-w-[24px] bg-primary rounded-t" 
                        style={{ height: `${height}%` }} 
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Similar Vehicle Sales</p>
              <div className="h-20 bg-muted rounded-md flex items-end p-2">
                {mockSimilarSales.map((price, index) => {
                  const height = (price / Math.max(...mockSimilarSales)) * 100;
                  return (
                    <div key={index} className="flex-1 flex flex-col items-center">
                      <div 
                        className="w-full max-w-[24px] bg-secondary rounded-t" 
                        style={{ height: `${height}%` }} 
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <h3 className="font-medium text-lg mb-4">Investment Outlook</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">5-Year Projected Value</p>
              <p className="font-medium">${(vehicle.market_value || 0 * 1.2).toLocaleString()}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Market Demand</p>
              <p className="font-medium">High</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Collector Interest</p>
              <p className="font-medium">Growing</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Market Liquidity</p>
              <p className="font-medium">Medium</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default VehicleMarketData;
