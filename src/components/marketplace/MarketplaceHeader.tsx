
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Filter, PlusSquare, Bell } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { authRequiredModalAtom } from '@/components/auth/AuthRequiredModal';
import FilterDialog from './FilterDialog';
import { useToast } from '@/components/ui/use-toast';

export const MarketplaceHeader = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [, setAuthModal] = useAtom(authRequiredModalAtom);
  const { toast } = useToast();
  
  // State for filter dialog
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // State for active filters
  const [activeFilters, setActiveFilters] = useState<any>(null);
  
  const isAuthenticated = !!session;
  
  const handleCreateListing = () => {
    if (!isAuthenticated) {
      setAuthModal({
        isOpen: true,
        message: "Sign in to create and publish your own listings.",
        actionType: "create"
      });
      return;
    }
    
    // In a real implementation, we would navigate to a form page
    // For now, we'll use a toast to indicate future functionality
    toast({
      title: "Create Listing",
      description: "This feature will be implemented soon. You'll be able to create and publish your own listings.",
    });
  };
  
  const handleSavedSearches = () => {
    if (!isAuthenticated) {
      setAuthModal({
        isOpen: true,
        message: "Sign in to save your searches for future reference.",
        actionType: "save"
      });
      return;
    }
    
    // In a real implementation, we would navigate to a saved searches page
    // For now, we'll use a toast to indicate future functionality
    toast({
      title: "Saved Searches & Alerts",
      description: "This feature will be implemented soon. You'll be able to view and manage your saved searches and alerts.",
    });
  };
  
  const handleApplyFilters = (filters: any) => {
    setActiveFilters(filters);
    
    // Show toast to indicate filters were applied
    toast({
      title: "Filters Applied",
      description: `Applied ${Object.values(filters).flat().filter(Boolean).length} filters to your search.`,
    });
    
    // In a real implementation, we would update the search results based on filters
    console.log("Applied filters:", filters);
  };
  
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search vehicles, parts, or services..."
            className="pl-8"
          />
        </div>
        
        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => setIsFilterOpen(true)}
            className={activeFilters ? "bg-primary/10" : ""}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
            {activeFilters && (
              <span className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {Object.values(activeFilters).flat().filter(Boolean).length}
              </span>
            )}
          </Button>
          
          <Button
            onClick={handleSavedSearches}
            variant="outline"
          >
            <Bell className="h-4 w-4 mr-2" />
            Alerts
          </Button>
          
          <Button onClick={handleCreateListing}>
            <PlusSquare className="h-4 w-4 mr-2" />
            {isAuthenticated ? "List Item" : "Sell"}
          </Button>
        </div>
      </div>
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
        <Tabs defaultValue="buy">
          <TabsList>
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="rent">Rent</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="parts">Parts</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="text-sm text-muted-foreground mt-2 sm:mt-0">
          {isAuthenticated ? (
            <span>Welcome back! You have 3 new matches based on your saved searches.</span>
          ) : (
            <span>
              <Button variant="link" className="h-auto p-0 text-sm" 
                onClick={() => navigate('/login')}>
                Sign in
              </Button> to save your searches and get notified about new listings.
            </span>
          )}
        </div>
      </div>
      
      {/* Filter Dialog */}
      <FilterDialog 
        open={isFilterOpen} 
        onOpenChange={setIsFilterOpen}
        onApplyFilters={handleApplyFilters}
      />
    </div>
  );
};
