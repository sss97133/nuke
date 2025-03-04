
import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ExploreSearchProps {
  onSearch: (term: string) => void;
}

export const ExploreSearch: React.FC<ExploreSearchProps> = ({ onSearch }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  
  // Debounce search term to avoid excessive API calls
  useEffect(() => {
    const timerId = setTimeout(() => {
      setDebouncedTerm(searchTerm);
    }, 500);
    
    return () => clearTimeout(timerId);
  }, [searchTerm]);
  
  // When debounced term changes, trigger the search
  useEffect(() => {
    onSearch(debouncedTerm);
  }, [debouncedTerm, onSearch]);
  
  const handleClear = () => {
    setSearchTerm('');
    onSearch('');
  };
  
  return (
    <div className="relative mb-6">
      <div className="flex items-center">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search for streams, vehicles, or topics..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-9 h-10"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
              onClick={handleClear}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
