
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search,
  SlidersHorizontal,
  Plus,
  MapPin
} from 'lucide-react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useAuth } from '@/hooks/use-auth';
import { useNavigate } from 'react-router-dom';

export const MarketplaceHeader = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Implement search functionality
    console.log('Searching for:', searchQuery);
  };

  const handleCreateListing = () => {
    if (isAuthenticated) {
      navigate('/marketplace/create');
    } else {
      navigate('/login?redirect=/marketplace/create');
    }
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <form onSubmit={handleSearch} className="relative flex-1 w-full">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search vehicles, parts, or keywords..."
          className="pl-8 w-full"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </form>
      
      <div className="flex gap-2 w-full sm:w-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="flex gap-1">
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">Filters</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuItem>
              Price: Low to High
            </DropdownMenuItem>
            <DropdownMenuItem>
              Price: High to Low
            </DropdownMenuItem>
            <DropdownMenuItem>
              Newest First
            </DropdownMenuItem>
            <DropdownMenuItem>
              Oldest First
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <MapPin className="h-4 w-4 mr-2" />
              Near Me
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        <Button onClick={handleCreateListing} size="sm" className="flex gap-1">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Sell</span>
        </Button>
      </div>
    </div>
  );
};
