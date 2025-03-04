
import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Filter, PlusSquare, Bell } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { authRequiredModalAtom } from '@/components/auth/AuthRequiredModal';

export const MarketplaceHeader = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [, setAuthModal] = useAtom(authRequiredModalAtom);
  
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
    
    // Navigate to create listing page (would be implemented in a real app)
    // navigate('/marketplace/create');
    alert('Create listing functionality would be implemented here');
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
    
    // Navigate to saved searches page (would be implemented in a real app)
    // navigate('/marketplace/saved-searches');
    alert('Saved searches functionality would be implemented here');
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
          <Button variant="outline">
            <Filter className="h-4 w-4 mr-2" />
            Filters
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
    </div>
  );
};
