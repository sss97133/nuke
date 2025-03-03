
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mail, Phone, Calendar, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { MarketplaceListing } from '../hooks/useMarketplaceListing';

interface MarketplaceListingContactProps {
  listing: MarketplaceListing;
}

const MarketplaceListingContact: React.FC<MarketplaceListingContactProps> = ({ 
  listing 
}) => {
  const [messageText, setMessageText] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [showContactForm, setShowContactForm] = useState(false);
  const { toast } = useToast();
  
  const handleSendMessage = () => {
    if (!messageText.trim()) return;
    
    // In a real app, this would send the message to the backend
    toast({
      title: "Message sent",
      description: "Your message has been sent to the seller.",
    });
    
    setMessageText('');
    setPhoneNumber('');
    setShowContactForm(false);
  };
  
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Seller Information</CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={listing.seller.avatar} />
              <AvatarFallback>{listing.seller.name.charAt(0)}</AvatarFallback>
            </Avatar>
            
            <div>
              <div className="font-medium">{listing.seller.name}</div>
              {listing.seller.rating && (
                <div className="text-sm text-muted-foreground">
                  ★ {listing.seller.rating} ({listing.seller.listings_count || 0} listings)
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-1 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Member since: </span>
            <span>{format(new Date(listing.seller.joinedDate), 'MMM yyyy')}</span>
          </div>
          
          <Button 
            className="w-full"
            onClick={() => setShowContactForm(true)}
          >
            Contact Seller
          </Button>
        </CardContent>
      </Card>
      
      {showContactForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Contact Seller</CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="message">
                Message <span className="text-destructive">*</span>
              </label>
              <Textarea
                id="message"
                placeholder="Hi, I'm interested in your listing. Is it still available?"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                This message will be shared on the public listing
              </p>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="phone">
                Your Phone Number (optional)
              </label>
              <Input
                id="phone"
                type="tel"
                placeholder="(123) 456-7890"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Only shared with the seller if you provide it
              </p>
            </div>
          </CardContent>
          
          <CardFooter className="flex justify-between">
            <Button 
              variant="outline" 
              onClick={() => setShowContactForm(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSendMessage}
              disabled={!messageText.trim()}
            >
              <MessageSquare className="h-4 w-4 mr-2" />
              Send Message
            </Button>
          </CardFooter>
        </Card>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Tips for Buyers</CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Badge variant="outline" className="w-full justify-start text-sm py-1 font-normal">
              Always meet in a public place
            </Badge>
            <Badge variant="outline" className="w-full justify-start text-sm py-1 font-normal">
              Check vehicle history reports
            </Badge>
            <Badge variant="outline" className="w-full justify-start text-sm py-1 font-normal">
              Take a test drive if possible
            </Badge>
            <Badge variant="outline" className="w-full justify-start text-sm py-1 font-normal">
              Verify all documentation
            </Badge>
          </div>
        </CardContent>
      </Card>
    </>
  );
};

export default MarketplaceListingContact;
