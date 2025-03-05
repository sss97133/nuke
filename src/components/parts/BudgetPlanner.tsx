
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { BarChart2, DollarSign, ChartPie, Calendar } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface BudgetData {
  planned: number;
  actual: number;
  difference: number;
  monthlySpending: { name: string; planned: number; actual: number; }[];
  categorySpending: { name: string; value: number; }[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

const BudgetPlanner = () => {
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
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

    fetchBudgetData();
  }, [toast]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold">Parts Budget Planner</h2>
        <Button className="flex items-center gap-2">
          <Calendar size={16} />
          Set Budget
        </Button>
      </div>
      
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : budgetData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className="p-2 bg-blue-100 rounded-full">
                  <DollarSign className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Planned Budget</p>
                  <h3 className="text-2xl font-bold">${budgetData.planned}</h3>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className="p-2 bg-green-100 rounded-full">
                  <BarChart2 className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Actual Spending</p>
                  <h3 className="text-2xl font-bold">${budgetData.actual}</h3>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center space-x-4">
                <div className={`p-2 ${budgetData.difference >= 0 ? 'bg-green-100' : 'bg-red-100'} rounded-full`}>
                  <DollarSign className={`h-6 w-6 ${budgetData.difference >= 0 ? 'text-green-600' : 'text-red-600'}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Remaining Budget</p>
                  <h3 className={`text-2xl font-bold ${budgetData.difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${Math.abs(budgetData.difference)} {budgetData.difference >= 0 ? 'Under' : 'Over'}
                  </h3>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle>Budget Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : budgetData && (
            <Tabs defaultValue="monthly" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="monthly">Monthly Spending</TabsTrigger>
                <TabsTrigger value="categories">Spending by Category</TabsTrigger>
              </TabsList>
              
              <TabsContent value="monthly">
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={budgetData.monthlySpending}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="planned" fill="#8884d8" name="Planned" />
                      <Bar dataKey="actual" fill="#82ca9d" name="Actual" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>
              
              <TabsContent value="categories">
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={budgetData.categorySpending}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                        nameKey="name"
                        label={(entry) => entry.name}
                      >
                        {budgetData.categorySpending.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `$${value}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border-b pb-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium">Brake System Overhaul</h4>
                    <p className="text-sm text-muted-foreground">Honda Civic</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold">$350</span>
                    <p className="text-sm text-muted-foreground">Due in 2 weeks</p>
                  </div>
                </div>
              </div>
              <div className="border-b pb-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium">Engine Tune-up Parts</h4>
                    <p className="text-sm text-muted-foreground">Toyota Camry</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold">$180</span>
                    <p className="text-sm text-muted-foreground">Due in 1 month</p>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium">Transmission Fluid Change</h4>
                    <p className="text-sm text-muted-foreground">Ford F-150</p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold">$120</span>
                    <p className="text-sm text-muted-foreground">Due in 6 weeks</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BudgetPlanner;
