
import React, { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, MapPin, Calendar, Tag, Search } from "lucide-react";

// Import refactored components
import SearchSection from "@/components/discover/SearchSection";
import TrendingTab from "@/components/discover/tabs/TrendingTab";
import NearbyTab from "@/components/discover/tabs/NearbyTab";
import EventsTab from "@/components/discover/tabs/EventsTab";
import CategoriesTab from "@/components/discover/tabs/CategoriesTab";

const Discover: React.FC = () => {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [makeFilter, setMakeFilter] = useState("");
  const [activeTab, setActiveTab] = useState("trending");
  
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    toast({
      title: "Searching vehicles",
      description: `Finding results for: ${searchQuery}`,
    });
    
    console.log("Searching for:", searchQuery, "Year:", yearFilter, "Make:", makeFilter);
  }, [searchQuery, yearFilter, makeFilter, toast]);
  
  return (
    <div className="container max-w-full px-4 py-6">
      <h1 className="text-3xl font-bold mb-6">Discover</h1>
      
      {/* Search Section */}
      <SearchSection 
        onSearch={handleSearch}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        yearFilter={yearFilter}
        setYearFilter={setYearFilter}
        makeFilter={makeFilter}
        setMakeFilter={setMakeFilter}
      />
      
      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 w-full max-w-xl mx-auto grid grid-cols-4">
          <TabsTrigger value="trending" className="flex items-center">
            <TrendingUp className="mr-2 h-4 w-4" />
            Trending
          </TabsTrigger>
          <TabsTrigger value="nearby" className="flex items-center">
            <MapPin className="mr-2 h-4 w-4" />
            Nearby
          </TabsTrigger>
          <TabsTrigger value="events" className="flex items-center">
            <Calendar className="mr-2 h-4 w-4" />
            Events
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex items-center">
            <Tag className="mr-2 h-4 w-4" />
            Categories
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="trending">
          <TrendingTab />
        </TabsContent>
        
        <TabsContent value="nearby">
          <NearbyTab />
        </TabsContent>
        
        <TabsContent value="events">
          <EventsTab />
        </TabsContent>
        
        <TabsContent value="categories">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Discover;
