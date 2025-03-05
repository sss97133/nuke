import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export interface BudgetData {
  planned: number;
  actual: number;
  difference: number;
  monthlySpending: { name: string; planned: number; actual: number; }[];
  categorySpending: { name: string; value: number; }[];
}

export const useBudget = () => {
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchBudgetData = async () => {
    try {
      setLoading(true);
      
      // In a real implementation, this would fetch from your database
      // For demo purposes, we're using mock data
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock data
      const mockData: BudgetData = {
        planned: 2500,
        actual: 2150,
        difference: 350,
        monthlySpending: [
          { name: 'Jan', planned: 200, actual: 180 },
          { name: 'Feb', planned: 300, actual: 250 },
          { name: 'Mar', planned: 400, actual: 420 },
          { name: 'Apr', planned: 200, actual: 180 },
          { name: 'May', planned: 300, actual: 380 },
          { name: 'Jun', planned: 400, actual: 340 },
        ],
        categorySpending: [
          { name: 'Filters', value: 420 },
          { name: 'Brakes', value: 680 },
          { name: 'Fluids', value: 350 },
          { name: 'Electrical', value: 230 },
          { name: 'Engine', value: 470 },
        ],
      };
      
      setBudgetData(mockData);
    } catch (error) {
      console.error('Error fetching budget data:', error);
      toast({
        title: "Error",
        description: "Could not load budget data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const setBudget = async (amount: number) => {
    try {
      setLoading(true);
      
      // In a real implementation, this would update your database
      // For demo purposes, we're updating the local state
      
      if (budgetData) {
        const newBudgetData = { 
          ...budgetData,
          planned: amount,
          difference: amount - budgetData.actual
        };
        
        setBudgetData(newBudgetData);
        
        toast({
          title: "Success",
          description: "Budget updated successfully",
          variant: "default"
        });
      }
    } catch (error) {
      console.error('Error setting budget:', error);
      toast({
        title: "Error",
        description: "Could not update budget",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBudgetData();
  }, [toast]);

  return {
    budgetData,
    loading,
    fetchBudgetData,
    setBudget
  };
};