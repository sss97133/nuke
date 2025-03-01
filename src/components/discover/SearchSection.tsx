
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

type SearchSectionProps = {
  onSearch: (e: React.FormEvent) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  yearFilter: string;
  setYearFilter: (year: string) => void;
  makeFilter: string;
  setMakeFilter: (make: string) => void;
};

const SearchSection: React.FC<SearchSectionProps> = ({
  onSearch,
  searchQuery,
  setSearchQuery,
  yearFilter,
  setYearFilter,
  makeFilter,
  setMakeFilter
}) => {
  return (
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
};

export default SearchSection;
