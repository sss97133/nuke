
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { checkQueryError } from '@/utils/supabase-helpers';

export const useGarageSearch = () => {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchGarages = async (query: string, location?: { lat: number; lng: number; radius?: number }) => {
    try {
      setLoading(true);
      setError(null);
      
      // Get the current user
      const { data: { user }, error } = await supabase.auth.getUser();
      checkQueryError(error);
      
      // Basic search query
      let supabaseQuery = supabase
        .from('garages')
        .select('*');
      
      // Add text search condition if query is provided
      if (query && query.trim() !== '') {
        supabaseQuery = supabaseQuery.ilike('name', `%${query}%`);
      }
      
      // Add location filter if provided
      if (location && location.lat && location.lng) {
        // In a real application, we would use PostGIS for proper geospatial querying
        // This is a simplified example
        const radius = location.radius || 50; // Default 50km radius
        
        // For demonstration, we'll just limit results
        supabaseQuery = supabaseQuery.limit(10);
      }
      
      const { data, error: searchError } = await supabaseQuery;
      
      checkQueryError(searchError);
      
      if (data) {
        setResults(data);
      }
    } catch (err) {
      setError('An error occurred while searching for garages');
      console.error('Garage search error:', err);
    } finally {
      setLoading(false);
    }
  };

  return {
    results,
    loading,
    error,
    searchGarages
  };
};
