
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/components/ui/use-toast";
import { UploadCloud } from "lucide-react";

interface CreateListingFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ListingFormData {
  title: string;
  description: string;
  price: string;
  category: string;
  condition: string;
  listingType: string;
  location: string;
  contactMethod: string;
  contactInfo: string;
  images: File[];
}

const initialFormData: ListingFormData = {
  title: '',
  description: '',
  price: '',
  category: '',
  condition: '',
  listingType: 'forsale',
  location: '',
  contactMethod: 'app',
  contactInfo: '',
  images: []
};

const CreateListingForm: React.FC<CreateListingFormProps> = ({
  open,
  onOpenChange,
  onSuccess
}) => {
  const [formData, setFormData] = useState<ListingFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  
  // Form field handlers
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileArray = Array.from(e.target.files);
      setFormData(prev => ({ ...prev, images: [...prev.images, ...fileArray] }));
    }
  };
  
  const removeImage = (index: number) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };
  
  // Form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Validate form data
    if (!formData.title || !formData.price || !formData.category || !formData.condition) {
      toast({
        title: "Missing required fields",
        description: "Please fill in all required fields.",
        variant: "destructive"
      });
      setIsSubmitting(false);
      return;
    }
    
    // In a real app, you would submit this to your API
    // For demo purposes, we'll just show a success toast
    setTimeout(() => {
      toast({
        title: "Listing created successfully",
        description: "Your listing has been published to the marketplace.",
        variant: "default"
      });
      
      // Reset form
      setFormData(initialFormData);
      setIsSubmitting(false);
      
      // Close dialog
      onOpenChange(false);
      
      // Call success callback if provided
      if (onSuccess) onSuccess();
    }, 1500);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Listing</DialogTitle>
          <DialogDescription>
            Fill out the form below to list your vehicle or part for sale.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title" className="required">Title</Label>
            <Input
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="e.g., 2015 Toyota Camry or BMW M3 Engine"
              required
            />
          </div>
          
          {/* Category & Condition */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category" className="required">Category</Label>
              <Select 
                value={formData.category} 
                onValueChange={(value) => handleSelectChange('category', value)}
              >
                <SelectTrigger id="category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="car">Car</SelectItem>
                  <SelectItem value="truck">Truck</SelectItem>
                  <SelectItem value="motorcycle">Motorcycle</SelectItem>
                  <SelectItem value="parts">Parts</SelectItem>
                  <SelectItem value="accessories">Accessories</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="condition" className="required">Condition</Label>
              <Select 
                value={formData.condition} 
                onValueChange={(value) => handleSelectChange('condition', value)}
              >
                <SelectTrigger id="condition">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="like-new">Like New</SelectItem>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="salvage">Salvage</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Price & Listing Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price" className="required">Price ($)</Label>
              <Input
                id="price"
                name="price"
                type="number"
                min="0"
                step="0.01"
                value={formData.price}
                onChange={handleChange}
                placeholder="Enter price"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label>Listing Type</Label>
              <RadioGroup 
                value={formData.listingType} 
                onValueChange={(value) => handleSelectChange('listingType', value)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="forsale" id="forsale" />
                  <Label htmlFor="forsale" className="cursor-pointer">For Sale</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="wanted" id="wanted" />
                  <Label htmlFor="wanted" className="cursor-pointer">Wanted</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe your item in detail..."
              className="min-h-[100px]"
            />
          </div>
          
          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="City, State"
            />
          </div>
          
          {/* Contact Preferences */}
          <div className="space-y-2">
            <Label>Contact Preference</Label>
            <RadioGroup 
              value={formData.contactMethod} 
              onValueChange={(value) => handleSelectChange('contactMethod', value)}
              className="flex flex-col space-y-1"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="app" id="app" />
                <Label htmlFor="app" className="cursor-pointer">In-app messaging only</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="phone" id="phone" />
                <Label htmlFor="phone" className="cursor-pointer">Phone</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="email" id="email" />
                <Label htmlFor="email" className="cursor-pointer">Email</Label>
              </div>
            </RadioGroup>
            
            {formData.contactMethod !== 'app' && (
              <div className="mt-2">
                <Input
                  id="contactInfo"
                  name="contactInfo"
                  value={formData.contactInfo}
                  onChange={handleChange}
                  placeholder={formData.contactMethod === 'phone' ? 'Phone number' : 'Email address'}
                />
              </div>
            )}
          </div>
          
          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Images</Label>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <label htmlFor="image-upload" className="cursor-pointer">
                <div className="flex flex-col items-center">
                  <UploadCloud className="h-10 w-10 text-muted-foreground mb-2" />
                  <span className="text-sm font-medium">
                    Drop files here or click to upload
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">
                    Support for JPG, PNG, GIF (max 5MB each)
                  </span>
                </div>
                <Input
                  id="image-upload"
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </label>
            </div>
            
            {formData.images.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {formData.images.map((file, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={URL.createObjectURL(file)}
                      alt={`Upload ${index + 1}`}
                      className="h-20 w-full object-cover rounded"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute top-1 right-1 bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={isSubmitting}
            >
              {isSubmitting ? "Publishing..." : "Publish Listing"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateListingForm;
