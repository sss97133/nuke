
import type { Database } from '../types';
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export interface ContentItem {
  id?: string;
  type: string;
  title: string;
  subtitle: string;
  image: string;
  tags: string[];
  reason: string;
  location: string;
  relevanceScore: number;
}

export const ContentEntryForm = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contentItem, setContentItem] = useState<ContentItem>({
    type: 'vehicle',
    title: '',
    subtitle: '',
    image: '',
    tags: [],
    reason: '',
    location: '',
    relevanceScore: 90
  });
  const [tagInput, setTagInput] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setContentItem(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setContentItem(prev => ({ ...prev, [name]: value }));
  };

  const handleTagsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTagInput(e.target.value);
  };

  const addTag = () => {
    if (tagInput.trim() !== '') {
      setContentItem(prev => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()]
      }));
      setTagInput('');
    }
  };

  const removeTag = (index: number) => {
    setContentItem(prev => ({
      ...prev,
      tags: prev.tags.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Insert content item to Supabase
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('explore_content')
        .insert([{
          type: contentItem.type,
          title: contentItem.title,
          subtitle: contentItem.subtitle,
          image_url: contentItem.image,
          tags: contentItem.tags,
          reason: contentItem.reason,
          location: contentItem.location,
          relevance_score: contentItem.relevanceScore
        }]);

      if (error) throw error;

      toast({
        title: 'Content Added',
        description: 'Your content has been successfully added to the Explore feed.',
      });

      // Reset form
      setContentItem({
        type: 'vehicle',
        title: '',
        subtitle: '',
        image: '',
        tags: [],
        reason: '',
        location: '',
        relevanceScore: 90
      });
    } catch (error: any) {
      console.error('Error adding content:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add content',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-md bg-card">
      <div className="space-y-2">
        <Label htmlFor="type">Content Type</Label>
        <Select 
          value={contentItem.type}
          onValueChange={(value) => handleSelectChange("type", value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select content type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vehicle">Vehicle</SelectItem>
            <SelectItem value="auction">Auction</SelectItem>
            <SelectItem value="event">Event</SelectItem>
            <SelectItem value="garage">Garage</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          value={contentItem.title}
          onChange={handleInputChange}
          placeholder="Title of the content"
          required
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="subtitle">Subtitle</Label>
        <Input
          id="subtitle"
          name="subtitle"
          value={contentItem.subtitle}
          onChange={handleInputChange}
          placeholder="Brief description"
          required
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="image">Image URL</Label>
        <Input
          id="image"
          name="image"
          type="url"
          value={contentItem.image}
          onChange={handleInputChange}
          placeholder="https://example.com/image.jpg"
          required
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="tags">Tags</Label>
        <div className="flex space-x-2">
          <Input
            id="tagInput"
            value={tagInput}
            onChange={handleTagsChange}
            placeholder="Add a tag"
          />
          <Button type="button" variant="outline" onClick={addTag}>
            Add
          </Button>
        </div>
        
        {contentItem.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {contentItem.tags.map((tag, index) => (
              <div key={index} className="bg-secondary text-secondary-foreground px-2 py-1 rounded-md flex items-center">
                {tag}
                <button 
                  type="button" 
                  className="ml-1 text-secondary-foreground/70 hover:text-secondary-foreground"
                  onClick={() => removeTag(index)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="reason">Reason for Recommendation</Label>
        <Textarea
          id="reason"
          name="reason"
          value={contentItem.reason}
          onChange={handleInputChange}
          placeholder="Why is this being recommended to the user?"
          required
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          name="location"
          value={contentItem.location}
          onChange={handleInputChange}
          placeholder="Location (e.g., City, State)"
          required
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="relevanceScore">Relevance Score (1-100)</Label>
        <Input
          id="relevanceScore"
          name="relevanceScore"
          type="number"
          min="1"
          max="100"
          value={contentItem.relevanceScore}
          onChange={handleInputChange}
          required
        />
      </div>
      
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          'Add Content'
        )}
      </Button>
    </form>
  );
};
