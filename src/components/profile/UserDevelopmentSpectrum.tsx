
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { InfoIcon, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface DevelopmentCategory {
  name: string;
  value: number;
  color: string;
  percentile?: number;
}

interface UserDevelopmentSpectrumProps {
  userId: string;
  categories: DevelopmentCategory[];
  isLoading?: boolean;
  hasError?: boolean;
}

export const UserDevelopmentSpectrum = ({ 
  userId, 
  categories, 
  isLoading = false, 
  hasError = false 
}: UserDevelopmentSpectrumProps) => {
  const { toast } = useToast();
  
  if (isLoading) {
    return (
      <div className="h-[300px] flex items-center justify-center">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  
  if (hasError || !categories.length) {
    return (
      <div className="h-[300px] flex flex-col items-center justify-center p-6 border rounded-lg bg-background/50">
        <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
        <h3 className="text-lg font-medium">No development data available</h3>
        <p className="text-sm text-muted-foreground text-center mt-2 mb-4">
          We don't have enough activity data to generate your development spectrum yet.
        </p>
        <Button 
          variant="outline" 
          onClick={() => {
            toast({
              title: "Development Spectrum",
              description: "Explore different areas of the platform to build your unique development profile!",
            });
          }}
        >
          Learn More
        </Button>
      </div>
    );
  }
  
  const RADIAN = Math.PI / 180;
  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    
    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        className="text-xs font-medium"
      >
        {`${name} ${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };
  
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background/95 border p-2 rounded-md shadow-md">
          <p className="font-medium">{data.name}</p>
          <p className="text-sm text-muted-foreground">Score: {data.value}</p>
          {data.percentile !== undefined && (
            <p className="text-sm text-muted-foreground">
              Top {data.percentile}% of users
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="border rounded-lg p-4 bg-background/50">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium">Development Spectrum</h3>
          <p className="text-sm text-muted-foreground">
            Your activity profile across different areas
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => {
          toast({
            title: "Development Spectrum",
            description: "This chart shows how your activities are distributed across different areas of the platform.",
          });
        }}>
          <InfoIcon className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={categories}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={renderCustomizedLabel}
              outerRadius={120}
              fill="#8884d8"
              dataKey="value"
            >
              {categories.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      
      <div className="mt-4 space-y-3">
        <h4 className="text-sm font-medium">Development Areas</h4>
        <div className="grid grid-cols-2 gap-2">
          {categories.map((category) => (
            <div key={category.name} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }} />
              <span className="text-sm">{category.name}</span>
              {category.percentile !== undefined && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Top {category.percentile}%
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
