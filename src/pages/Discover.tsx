
import React, { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, MapPin, Compass, Calendar, TrendingUp, 
  Car, Tag, Users, Clock, Filter 
} from "lucide-react";

// Components to help break down the large file
const SearchSection = ({ onSearch, searchQuery, setSearchQuery, yearFilter, setYearFilter, makeFilter, setMakeFilter }) => (
  <Card className="mb-8">
    <CardHeader>
      <CardTitle className="flex items-center">
        <Search className="mr-2 h-5 w-5" />
        Vehicle Search
      </CardTitle>
    </CardHeader>
    <CardContent>
      <form onSubmit={onSearch}>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label htmlFor="search">Search</Label>
            <Input 
              id="search" 
              placeholder="Search by model, features, or keywords..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-1"
            />
          </div>
          
          <div>
            <Label htmlFor="year">Year</Label>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger id="year" className="mt-1">
                <SelectValue placeholder="Any year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any year</SelectItem>
                {[...Array(30)].map((_, i) => (
                  <SelectItem key={i} value={(2023 - i).toString()}>
                    {2023 - i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <Label htmlFor="make">Make</Label>
            <Select value={makeFilter} onValueChange={setMakeFilter}>
              <SelectTrigger id="make" className="mt-1">
                <SelectValue placeholder="Any make" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any make</SelectItem>
                {["Toyota", "Honda", "Ford", "BMW", "Mercedes", "Audi", "Tesla", "Porsche"].map((make) => (
                  <SelectItem key={make} value={make}>{make}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="md:col-span-4 flex justify-end">
            <Button type="submit" className="mt-2">
              <Search className="mr-2 h-4 w-4" />
              Search Vehicles
            </Button>
          </div>
        </div>
      </form>
    </CardContent>
  </Card>
);

const TrendingTab = () => (
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

const FeaturedListings = () => (
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

const NearbyTab = () => (
  <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
    <div className="lg:col-span-2">
      <Card className="overflow-hidden">
        <div className="h-[500px] bg-muted flex items-center justify-center">
          <MapPin className="h-12 w-12 text-muted-foreground" />
          <span className="ml-2 text-muted-foreground text-lg">Interactive Map will be displayed here</span>
        </div>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            Displaying vehicle-related locations within 25 miles of your current location.
          </p>
        </CardContent>
      </Card>
    </div>
    
    <div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Compass className="mr-2 h-5 w-5" />
            Nearby Locations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { name: "Classic Auto Gallery", type: "Dealership", distance: "2.3 miles" },
              { name: "Veteran Motors", type: "Service", distance: "4.1 miles" },
              { name: "AutoTech Specialists", type: "Parts", distance: "5.7 miles" },
              { name: "Cars & Coffee Meetup", type: "Event", distance: "7.2 miles" },
              { name: "Vintage Racing Club", type: "Community", distance: "8.5 miles" },
              { name: "MotorElegance Auctions", type: "Auction House", distance: "12.8 miles" },
            ].map((location, i) => (
              <div key={i} className="flex justify-between p-2 hover:bg-accent rounded cursor-pointer">
                <div>
                  <div className="font-medium">{location.name}</div>
                  <div className="text-sm text-muted-foreground">{location.type}</div>
                </div>
                <div className="text-sm self-center">{location.distance}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Filter className="mr-2 h-5 w-5" />
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="distance">Distance</Label>
              <Select defaultValue="25">
                <SelectTrigger id="distance">
                  <SelectValue placeholder="Select distance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 miles</SelectItem>
                  <SelectItem value="10">10 miles</SelectItem>
                  <SelectItem value="25">25 miles</SelectItem>
                  <SelectItem value="50">50 miles</SelectItem>
                  <SelectItem value="100">100 miles</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="type">Location Type</Label>
              <Select defaultValue="all">
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="dealership">Dealerships</SelectItem>
                  <SelectItem value="service">Service Centers</SelectItem>
                  <SelectItem value="parts">Parts Suppliers</SelectItem>
                  <SelectItem value="events">Events</SelectItem>
                  <SelectItem value="community">Communities</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button variant="outline" className="w-full">
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);

const EventsTab = () => (
  <div className="space-y-6">
    <div className="flex justify-between mb-6">
      <h2 className="text-xl font-semibold">Upcoming Events</h2>
      <div className="flex gap-2">
        <Select defaultValue="upcoming">
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="popular">Most Popular</SelectItem>
            <SelectItem value="nearest">Nearest</SelectItem>
          </SelectContent>
        </Select>
        
        <Button variant="outline">
          <Filter className="h-4 w-4 mr-2" />
          Filter
        </Button>
      </div>
    </div>
    
    {[
      { 
        title: "Annual Concours d'Elegance", 
        date: "June 15-17, 2023", 
        location: "Pebble Beach, CA",
        description: "The premier celebration of automotive excellence featuring the world's most beautiful and rare automobiles.",
        attendees: 2500,
        interested: 342
      },
      { 
        title: "Motorcraft Auction Gala", 
        date: "July 8, 2023", 
        location: "Phoenix, AZ",
        description: "Exclusive auction event featuring rare classics and modern exotics with proceeds supporting automotive preservation.",
        attendees: 800,
        interested: 178
      },
      { 
        title: "Vintage Rally Championship", 
        date: "August 3-5, 2023", 
        location: "Portland, OR",
        description: "Three-day rally featuring pre-1980 vehicles competing across the stunning Pacific Northwest landscape.",
        attendees: 1200,
        interested: 230
      },
      { 
        title: "Future of Mobility Conference", 
        date: "September 12, 2023", 
        location: "Detroit, MI",
        description: "Industry leaders discuss emerging trends in electric vehicles, autonomous driving, and sustainable transportation.",
        attendees: 1800,
        interested: 412
      },
    ].map((event, i) => (
      <Card key={i} className="overflow-hidden">
        <div className="md:flex">
          <div className="md:w-1/4 bg-muted h-40 md:h-auto flex items-center justify-center flex-shrink-0">
            <Calendar className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="p-6 md:w-3/4">
            <h3 className="text-xl font-semibold mb-2">{event.title}</h3>
            <div className="flex flex-wrap gap-y-2 mb-3">
              <div className="flex items-center mr-4">
                <Calendar className="h-4 w-4 mr-1 text-muted-foreground" />
                <span className="text-sm">{event.date}</span>
              </div>
              <div className="flex items-center">
                <MapPin className="h-4 w-4 mr-1 text-muted-foreground" />
                <span className="text-sm">{event.location}</span>
              </div>
            </div>
            <p className="text-muted-foreground mb-4">{event.description}</p>
            <div className="flex justify-between items-center">
              <div className="text-sm text-muted-foreground">
                <span>{event.attendees} attending</span>
                <span className="mx-2">•</span>
                <span>{event.interested} interested</span>
              </div>
              <div className="space-x-2">
                <Button variant="outline" size="sm">Interested</Button>
                <Button size="sm">Register</Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
    ))}
  </div>
);

const CategoriesTab = () => (
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

const Discover = () => {
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
