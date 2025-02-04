import React from 'react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ThumbsUp, MessageSquare, Brain } from 'lucide-react';

interface PodcastAnalyticsProps {
  episodeId: string;
}

export const PodcastAnalytics = ({ episodeId }: PodcastAnalyticsProps) => {
  // This would be replaced with real data from your Supabase subscriptions
  const mockNotes = [
    { id: 1, timestamp: '00:05:23', note: "Discussion about electric vehicles' impact on urban infrastructure" },
    { id: 2, timestamp: '00:08:45', note: "Guest's experience with Tesla's autopilot features" }
  ];

  const mockComments = [
    { id: 1, user: "John D.", text: "Great insights on EV charging!", timestamp: "2m ago" },
    { id: 2, user: "Sarah M.", text: "Can you discuss battery life?", timestamp: "1m ago" }
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-4 h-4" />
          <h3 className="text-sm font-semibold">AI Notes</h3>
        </div>
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {mockNotes.map((note) => (
              <div key={note.id} className="text-sm border-l-2 border-primary pl-2">
                <span className="text-xs text-muted-foreground">{note.timestamp}</span>
                <p>{note.note}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Live Engagement</h3>
          </div>
          <div className="flex items-center gap-2">
            <ThumbsUp className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium">4.8</span>
          </div>
        </div>
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {mockComments.map((comment) => (
              <div key={comment.id} className="text-sm bg-muted p-2 rounded">
                <div className="flex justify-between">
                  <span className="font-medium">{comment.user}</span>
                  <span className="text-xs text-muted-foreground">{comment.timestamp}</span>
                </div>
                <p className="mt-1">{comment.text}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
};