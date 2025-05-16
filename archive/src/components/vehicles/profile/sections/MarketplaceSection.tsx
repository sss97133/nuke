import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  Tag,
  Clock,
  Eye,
  MessageSquare,
  Star,
  Share2,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

interface MarketplaceSectionProps {
  vehicleId: string;
  isOwner: boolean;
}

interface MarketListing {
  id: string;
  price: number;
  currency: string;
  condition: string;
  description: string;
  created_at: string;
  views: number;
  inquiries: number;
  is_featured: boolean;
  is_negotiable: boolean;
  status: 'active' | 'pending' | 'sold';
}

export const MarketplaceSection = ({ vehicleId, isOwner }: MarketplaceSectionProps) => {
  const [listing, setListing] = useState<MarketListing>({
    id: '1',
    price: 45000,
    currency: 'USD',
    condition: 'Excellent',
    description: 'Fully restored classic in excellent condition. Complete service history available.',
    created_at: '2024-03-15T10:00:00Z',
    views: 234,
    inquiries: 12,
    is_featured: true,
    is_negotiable: true,
    status: 'active'
  });

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="space-y-6">
      {/* Listing Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Marketplace Listing</CardTitle>
            {isOwner && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button>Edit Listing</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Edit Marketplace Listing</DialogTitle>
                    <DialogDescription>
                      Update your vehicle&apos;s marketplace listing details.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="price">Price</Label>
                      <div className="flex gap-2">
                        <Select defaultValue={listing.currency}>
                          <SelectTrigger className="w-24">
                            <SelectValue placeholder="Currency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          id="price"
                          type="number"
                          defaultValue={listing.price}
                          className="flex-1"
                        />
                      </div>
                    </div>
                    
                    <div className="grid gap-2">
                      <Label htmlFor="condition">Condition</Label>
                      <Select defaultValue={listing.condition}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select condition" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Excellent">Excellent</SelectItem>
                          <SelectItem value="Good">Good</SelectItem>
                          <SelectItem value="Fair">Fair</SelectItem>
                          <SelectItem value="Poor">Poor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="grid gap-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        defaultValue={listing.description}
                        rows={4}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <Label htmlFor="negotiable">Price Negotiable</Label>
                      <Switch
                        id="negotiable"
                        defaultChecked={listing.is_negotiable}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <Label htmlFor="featured">Feature Listing</Label>
                      <Switch
                        id="featured"
                        defaultChecked={listing.is_featured}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline">Cancel</Button>
                    <Button>Save Changes</Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-2xl font-bold">
                  {formatCurrency(listing.price, listing.currency)}
                </h3>
                {listing.is_negotiable && (
                  <Badge variant="outline">Negotiable</Badge>
                )}
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  <span>Condition: {listing.condition}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>Listed on {formatDate(listing.created_at)}</span>
                </div>
              </div>
              
              <p className="mt-4 text-sm text-muted-foreground">
                {listing.description}
              </p>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <Eye className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
                  <div className="text-2xl font-semibold">{listing.views}</div>
                  <div className="text-xs text-muted-foreground">Views</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <MessageSquare className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
                  <div className="text-2xl font-semibold">{listing.inquiries}</div>
                  <div className="text-xs text-muted-foreground">Inquiries</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <Star className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
                  <div className="text-2xl font-semibold">4.8</div>
                  <div className="text-xs text-muted-foreground">Rating</div>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button className="flex-1">
                  Contact Seller
                </Button>
                <Button variant="outline" size="icon">
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Market Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Market Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div>
                <div className="text-sm text-muted-foreground">Market Average</div>
                <div className="text-lg font-semibold">{formatCurrency(48500, 'USD')}</div>
              </div>
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Recent Sales</div>
                <div className="text-lg font-semibold">12</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Time on Market</div>
                <div className="text-lg font-semibold">45 days avg.</div>
              </div>
            </div>
            
            <Button variant="outline" className="w-full">
              View Full Market Report
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}; 