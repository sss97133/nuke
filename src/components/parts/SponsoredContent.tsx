import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ShoppingCart, ExternalLink, Percent } from 'lucide-react';

interface SponsoredItem {
  id: string;
  title: string;
  description: string;
  price: number;
  discount: number;
  imageUrl: string;
  retailer: string;
  url: string;
}

const SponsoredContent = () => {
  const [items, setItems] = useState<SponsoredItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchSponsoredItems = useCallback(async () => {
    try {
      setLoading(true);
      // In a real implementation, this would fetch from your API
      // For demo purposes, we're using mock data
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock data
      const mockItems: SponsoredItem[] = [
        {
          id: '1',
          title: 'Premium Oil Filter Set',
          description: 'High-performance oil filters for all Japanese vehicles.',
          price: 24.99,
          discount: 15,
          imageUrl: 'https://images.unsplash.com/photo-1487058792275-0ad4aaf24ca7',
          retailer: 'AutoZone',
          url: '#'
        },
        {
          id: '2',
          title: 'Ceramic Brake Pad Kit',
          description: 'Low dust, noise-free braking for luxury vehicles.',
          price: 89.99,
          discount: 20,
          imageUrl: 'https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d',
          retailer: 'NAPA Auto Parts',
          url: '#'
        },
        {
          id: '3',
          title: 'Complete Tune-Up Kit',
          description: 'All the parts you need for a comprehensive engine tune-up.',
          price: 65.99,
          discount: 10,
          imageUrl: 'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b',
          retailer: "O'Reilly Auto Parts",
          url: '#'
        },
        {
          id: '4',
          title: 'Synthetic Oil Change Bundle',
          description: 'Full synthetic oil with filter and disposal kit.',
          price: 42.99,
          discount: 25,
          imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475',
          retailer: 'Advance Auto Parts',
          url: '#'
        },
      ];
      
      setItems(mockItems);
    } catch (error) {
      console.error('Error fetching sponsored items:', error);
      toast({
        title: "Error",
        description: "Could not load sponsored content",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSponsoredItems();
  }, [fetchSponsoredItems]);

  const getSalePrice = (price: number, discount: number) => {
    return (price * (1 - discount / 100)).toFixed(2);
  };

  const handleBuyClick = (item: SponsoredItem) => {
    // In a real implementation, this would add the item to cart or redirect to purchase page
    toast({
      title: "Added to cart",
      description: `${item.title} has been added to your cart`
    });
  };

  const handleViewOffer = (title: string) => {
    // In a real implementation, this would open the offer details
    toast({
      title: "Viewing offer",
      description: `Opening details for ${title}`
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Special Deals & Offers</h2>
          <p className="text-muted-foreground">
            Exclusive parts deals selected for your vehicles
          </p>
        </div>
      </div>
      
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-48 w-full" />
              <CardContent className="p-4">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-1" />
                <Skeleton className="h-4 w-full mb-4" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map(item => (
            <Card key={item.id} className="overflow-hidden flex flex-col">
              <div 
                className="h-48 bg-cover bg-center relative"
                style={{ backgroundImage: `url(${item.imageUrl})` }}
              >
                {item.discount > 0 && (
                  <div className="absolute top-0 right-0 bg-red-500 text-white px-2 py-1 m-2 rounded flex items-center">
                    <Percent className="h-3 w-3 mr-1" /> 
                    {item.discount}% OFF
                  </div>
                )}
              </div>
              <CardContent className="p-4 flex-grow flex flex-col">
                <div className="mb-2">
                  <h3 className="font-bold text-lg">{item.title}</h3>
                  <p className="text-sm text-muted-foreground mb-2">{item.description}</p>
                </div>
                <div className="flex justify-between items-center mt-auto">
                  <div>
                    {item.discount > 0 ? (
                      <div>
                        <span className="text-sm line-through text-muted-foreground mr-2">${item.price.toFixed(2)}</span>
                        <span className="font-bold text-red-500">${getSalePrice(item.price, item.discount)}</span>
                      </div>
                    ) : (
                      <span className="font-bold">${item.price.toFixed(2)}</span>
                    )}
                    <p className="text-xs text-muted-foreground">From {item.retailer}</p>
                  </div>
                  <Button 
                    size="sm" 
                    className="flex items-center gap-1"
                    onClick={() => handleBuyClick(item)}
                  >
                    <ShoppingCart className="h-3 w-3" />
                    <span>Buy</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle>Limited Time Offers</CardTitle>
          <CardDescription>These special deals expire soon</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border rounded-md p-4 flex justify-between items-center">
                <div>
                  <h4 className="font-medium">Summer Service Special</h4>
                  <p className="text-sm text-muted-foreground">Complete A/C service kit - 30% off with code SUMMER30</p>
                </div>
                <Button 
                  variant="outline" 
                  className="flex items-center gap-1"
                  onClick={() => handleViewOffer('Summer Service Special')}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>View</span>
                </Button>
              </div>
              
              <div className="border rounded-md p-4 flex justify-between items-center">
                <div>
                  <h4 className="font-medium">Brake System Bundle</h4>
                  <p className="text-sm text-muted-foreground">Complete front and rear brake kit - Buy front, get rear 50% off</p>
                </div>
                <Button 
                  variant="outline" 
                  className="flex items-center gap-1"
                  onClick={() => handleViewOffer('Brake System Bundle')}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>View</span>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SponsoredContent;