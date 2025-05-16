import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Youtube,
  Instagram,
  Twitter,
  Facebook,
  Camera,
  Wrench,
  Calendar,
  MessageSquare,
  Share2,
  ThumbsUp,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UpdatesFeedProps {
  vehicleId: string;
}

type UpdateType = 'social' | 'youtube' | 'event' | 'maintenance' | 'comment';

interface Update {
  id: string;
  type: UpdateType;
  source: string;
  content: string;
  media_url?: string;
  timestamp: string;
  likes?: number;
  comments?: number;
  shares?: number;
}

export const UpdatesFeed = ({ vehicleId }: UpdatesFeedProps) => {
  const [loading, setLoading] = useState(false);
  const [updates, setUpdates] = useState<Update[]>([
    {
      id: '1',
      type: 'social',
      source: 'instagram',
      content: 'Just finished the new paint job! What do you think? 🚗✨',
      media_url: 'https://example.com/car-photo.jpg',
      timestamp: '2024-03-20T15:30:00Z',
      likes: 156,
      comments: 23,
      shares: 12
    },
    {
      id: '2',
      type: 'youtube',
      source: 'youtube',
      content: 'Full restoration process - Part 3: Engine Rebuild',
      media_url: 'https://youtube.com/watch?v=abc123',
      timestamp: '2024-03-19T10:15:00Z',
      likes: 1205,
      comments: 89,
      shares: 45
    },
    {
      id: '3',
      type: 'maintenance',
      source: 'system',
      content: 'Scheduled maintenance completed: Oil change, brake inspection',
      timestamp: '2024-03-18T14:20:00Z'
    },
    {
      id: '4',
      type: 'event',
      source: 'system',
      content: 'Registered for upcoming car show: Classic Car Sunday',
      timestamp: '2024-03-17T09:45:00Z'
    }
  ]);

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'youtube':
        return <Youtube className="h-4 w-4" />;
      case 'instagram':
        return <Instagram className="h-4 w-4" />;
      case 'twitter':
        return <Twitter className="h-4 w-4" />;
      case 'facebook':
        return <Facebook className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getTypeIcon = (type: UpdateType) => {
    switch (type) {
      case 'social':
        return <Camera className="h-4 w-4" />;
      case 'youtube':
        return <Youtube className="h-4 w-4" />;
      case 'event':
        return <Calendar className="h-4 w-4" />;
      case 'maintenance':
        return <Wrench className="h-4 w-4" />;
      case 'comment':
        return <MessageSquare className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
  };

  const renderUpdate = (update: Update) => (
    <Card key={update.id} className="mb-4">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-muted p-2">
              {getTypeIcon(update.type)}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                {getSourceIcon(update.source)}
                <span className="text-sm font-medium">
                  {update.source.charAt(0).toUpperCase() + update.source.slice(1)}
                </span>
                <span className="text-sm text-muted-foreground">
                  • {formatDate(update.timestamp)}
                </span>
              </div>
              <p className="text-sm">{update.content}</p>
              
              {update.media_url && (
                <div className="mt-3 rounded-md overflow-hidden">
                  {update.type === 'youtube' ? (
                    <div className="aspect-video bg-muted flex items-center justify-center">
                      <Youtube className="h-8 w-8 text-muted-foreground" />
                    </div>
                  ) : (
                    <img 
                      src={update.media_url} 
                      alt="Update media" 
                      className="w-full h-48 object-cover"
                    />
                  )}
                </div>
              )}
              
              {(update.likes || update.comments || update.shares) && (
                <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                  {update.likes && (
                    <div className="flex items-center gap-1">
                      <ThumbsUp className="h-4 w-4" />
                      {update.likes}
                    </div>
                  )}
                  {update.comments && (
                    <div className="flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" />
                      {update.comments}
                    </div>
                  )}
                  {update.shares && (
                    <div className="flex items-center gap-1">
                      <Share2 className="h-4 w-4" />
                      {update.shares}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                Share Update
              </DropdownMenuItem>
              <DropdownMenuItem>
                Copy Link
              </DropdownMenuItem>
              <DropdownMenuItem className="text-red-600">
                Report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3 mt-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Latest Updates</h2>
        <Button variant="outline" size="sm">
          Connect Source
        </Button>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
          <TabsTrigger value="youtube">YouTube</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {updates.map(renderUpdate)}
        </TabsContent>

        <TabsContent value="social" className="mt-4">
          {updates.filter(u => u.type === 'social').map(renderUpdate)}
        </TabsContent>

        <TabsContent value="youtube" className="mt-4">
          {updates.filter(u => u.type === 'youtube').map(renderUpdate)}
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          {updates.filter(u => u.type === 'event').map(renderUpdate)}
        </TabsContent>

        <TabsContent value="maintenance" className="mt-4">
          {updates.filter(u => u.type === 'maintenance').map(renderUpdate)}
        </TabsContent>
      </Tabs>
    </div>
  );
}; 