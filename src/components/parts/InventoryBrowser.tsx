
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Filter, Plus, Edit, Trash } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Define the part type
interface Part {
  id: string;
  name: string;
  category: string;
  compatibleVehicles: string;
  quantity: number;
  price: number;
  supplier: string;
}

const InventoryBrowser = () => {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const { toast } = useToast();

  useEffect(() => {
    const fetchParts = async () => {
      try {
        setLoading(true);
        // In a real implementation, this would fetch from your parts database
        // For demo purposes, we're using mock data
        
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock data
        const mockParts: Part[] = [
          { id: '1', name: 'Oil Filter', category: 'Filters', compatibleVehicles: 'Toyota, Honda', quantity: 15, price: 12.99, supplier: 'AutoZone' },
          { id: '2', name: 'Brake Pads (Front)', category: 'Brakes', compatibleVehicles: 'Ford, Chevrolet', quantity: 8, price: 45.99, supplier: 'NAPA Auto Parts' },
          { id: '3', name: 'Air Filter', category: 'Filters', compatibleVehicles: 'Honda, Nissan', quantity: 3, price: 18.50, supplier: 'O\'Reilly Auto Parts' },
          { id: '4', name: 'Spark Plugs', category: 'Ignition', compatibleVehicles: 'All', quantity: 24, price: 8.99, supplier: 'AutoZone' },
          { id: '5', name: 'Wiper Blades', category: 'Exterior', compatibleVehicles: 'All', quantity: 10, price: 15.99, supplier: 'Advance Auto Parts' },
        ];
        
        setParts(mockParts);
      } catch (error) {
        console.error('Error fetching parts:', error);
        toast({
          title: "Error",
          description: "Could not load parts inventory data",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchParts();
  }, [toast]);

  const filteredParts = parts.filter(part => {
    // Filter by search query
    const matchesSearch = part.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          part.supplier.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          part.compatibleVehicles.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Filter by category
    const matchesCategory = categoryFilter === 'all' || part.category === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...new Set(parts.map(part => part.category))];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold">Parts Inventory</h2>
        <Button className="flex items-center gap-2">
          <Plus size={16} />
          Add New Part
        </Button>
      </div>
      
      <Card>
        <CardHeader className="pb-0">
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="flex items-center gap-2 w-full md:w-1/2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search parts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(category => (
                    <SelectItem key={category} value={category}>
                      {category === 'all' ? 'All Categories' : category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Compatible Vehicles</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredParts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10">
                      No parts found. Try adjusting your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredParts.map(part => (
                    <TableRow key={part.id}>
                      <TableCell className="font-medium">{part.name}</TableCell>
                      <TableCell>{part.category}</TableCell>
                      <TableCell>{part.compatibleVehicles}</TableCell>
                      <TableCell className={part.quantity <= 5 ? "text-red-500 font-bold" : ""}>
                        {part.quantity}
                      </TableCell>
                      <TableCell>${part.price.toFixed(2)}</TableCell>
                      <TableCell>{part.supplier}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500">
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryBrowser;
