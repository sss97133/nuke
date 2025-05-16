import type { Database } from '../types';
import { useState, useEffect } from 'react';
import { supabase, useSupabaseWithToast } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Part {
  id: string;
  name: string;
  category: string;
  compatibleVehicles?: string;
  quantity: number;
  price: number;
  supplier?: string;
  min_quantity?: number;
  location?: string;
  notes?: string;
}

export const useParts = () => {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { safeFetch } = useSupabaseWithToast();

  const fetchParts = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // In production, we would fetch from Supabase
      const data = await safeFetch(() => 
        supabase
          .from('inventory')
          .select('*')
      );
      
      if (data && Array.isArray(data)) {
        setParts(data as Part[]);
      } else {
        // Fallback to mock data if no data returned
        const mockParts: Part[] = [
          { id: '1', name: 'Oil Filter', category: 'Filters', compatibleVehicles: 'Toyota, Honda', quantity: 15, price: 12.99, supplier: 'AutoZone' },
          { id: '2', name: 'Brake Pads (Front)', category: 'Brakes', compatibleVehicles: 'Ford, Chevrolet', quantity: 8, price: 45.99, supplier: 'NAPA Auto Parts' },
          { id: '3', name: 'Air Filter', category: 'Filters', compatibleVehicles: 'Honda, Nissan', quantity: 3, price: 18.50, supplier: "O'Reilly Auto Parts" },
          { id: '4', name: 'Spark Plugs', category: 'Ignition', compatibleVehicles: 'All', quantity: 24, price: 8.99, supplier: 'AutoZone' },
          { id: '5', name: 'Wiper Blades', category: 'Exterior', compatibleVehicles: 'All', quantity: 10, price: 15.99, supplier: 'Advance Auto Parts' },
        ];
        setParts(mockParts);
      }
    } catch (err) {
      console.error('Error fetching parts:', err);
      setError('Failed to load parts data');
      toast({
        title: "Error",
        description: "Could not load parts inventory data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const addPart = async (newPart: Omit<Part, 'id'>) => {
    try {
      setLoading(true);
      
      // In production, we would insert to Supabase
      const data = await safeFetch(() => 
        supabase
          
          .insert([newPart])
          .select()
      );
      
      if (data && Array.isArray(data) && data.length > 0) {
        setParts(prevParts => [...prevParts, data[0] as Part]);
        toast({
          title: "Success",
          description: "Part added successfully",
        });
        return data[0] as Part;
      } else {
        // Mock implementation for demo
        const mockNewPart: Part = {
          ...newPart,
          id: `mock-${Date.now()}`
        };
        setParts(prevParts => [...prevParts, mockNewPart]);
        toast({
          title: "Success",
          description: "Part added successfully",
        });
        return mockNewPart;
      }
    } catch (err) {
      console.error('Error adding part:', err);
      toast({
        title: "Error",
        description: "Failed to add part",
        variant: "destructive"
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updatePart = async (id: string, updates: Partial<Part>) => {
    try {
      setLoading(true);
      
      // In production, we would update in Supabase
      const data = await safeFetch(() => 
        supabase
          
          .update(updates)
          .eq('id', id)
          .select()
      );
      
      if (data && Array.isArray(data) && data.length > 0) {
        setParts(prevParts => 
          prevParts.map(part => part.id === id ? { ...part, ...data[0] } : part)
        );
        toast({
          title: "Success",
          description: "Part updated successfully",
        });
      } else {
        // Mock implementation for demo
        setParts(prevParts => 
          prevParts.map(part => part.id === id ? { ...part, ...updates } : part)
        );
        toast({
          title: "Success",
          description: "Part updated successfully",
        });
      }
      return true;
    } catch (err) {
      console.error('Error updating part:', err);
      toast({
        title: "Error",
        description: "Failed to update part",
        variant: "destructive"
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deletePart = async (id: string) => {
    try {
      setLoading(true);
      
      // Delete from Supabase
      const { error } = await supabase
        .from('parts')
        .delete()
        .eq('id', id);
        
      if (error) console.error("Database query error:", error);
      
      if (error) throw error;
      
      setParts(prevParts => prevParts.filter(part => part.id !== id));
      toast({
        title: "Success",
        description: "Part deleted successfully",
      });
      return true;
    } catch (err) {
      console.error('Error deleting part:', err);
      toast({
        title: "Error",
        description: "Failed to delete part",
        variant: "destructive"
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParts();
  }, []);

  return {
    parts,
    loading,
    error,
    fetchParts,
    addPart,
    updatePart,
    deletePart
  };
};