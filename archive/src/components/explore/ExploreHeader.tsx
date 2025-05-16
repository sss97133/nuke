
import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Compass, Zap, MapPin, Target, Car, Hammer, Calendar, Users, RotateCcw } from 'lucide-react';
import { Button } from "@/components/ui/button";

interface ExploreHeaderProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}

export const ExploreHeader = ({ activeFilter, onFilterChange }: ExploreHeaderProps) => {
  const filters = [
    { id: 'all', label: 'All', icon: Compass },
    { id: 'vehicles', label: 'Vehicles', icon: Car },
    { id: 'auctions', label: 'Auctions', icon: Hammer },
    { id: 'events', label: 'Events', icon: Calendar },
    { id: 'garages', label: 'Garages', icon: Users }
  ];
  
  return (
    <div className="bg-muted/40 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-medium">Content Filters</h2>
        </div>
        
        <Button 
          variant="ghost" 
          size="sm" 
          className="flex items-center gap-1"
          onClick={() => onFilterChange('all')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset</span>
        </Button>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {filters.map(filter => (
          <Badge 
            key={filter.id}
            variant={activeFilter === filter.id ? "default" : "outline"}
            className="cursor-pointer py-1.5 text-xs flex items-center gap-1.5"
            onClick={() => onFilterChange(filter.id)}
          >
            <filter.icon className="h-3 w-3" />
            {filter.label}
          </Badge>
        ))}
      </div>
    </div>
  );
};
