import { useState, useCallback } from 'react';

export interface MapFilters {
  make?: string;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  platform?: string;
}

export function useMapFilters() {
  const [filters, setFilters] = useState<MapFilters>({});

  const setMake = useCallback((make: string | undefined) => {
    setFilters(f => ({ ...f, make: make || undefined }));
  }, []);

  const setYearRange = useCallback((min?: number, max?: number) => {
    setFilters(f => ({ ...f, yearMin: min, yearMax: max }));
  }, []);

  const setPriceRange = useCallback((min?: number, max?: number) => {
    setFilters(f => ({ ...f, priceMin: min, priceMax: max }));
  }, []);

  const setPlatform = useCallback((platform: string | undefined) => {
    setFilters(f => ({ ...f, platform: platform || undefined }));
  }, []);

  const clear = useCallback(() => setFilters({}), []);

  const hasFilters = Object.values(filters).some(v => v !== undefined);

  return { filters, setMake, setYearRange, setPriceRange, setPlatform, clear, hasFilters };
}
