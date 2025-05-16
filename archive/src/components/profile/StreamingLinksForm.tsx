import React from 'react';
import { Video, Youtube, Twitch, ArrowBigDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StreamingLinks } from './types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StreamingLinksFormProps {
  streamingLinks: StreamingLinks;
  onStreamingLinksChange: (links: StreamingLinks) => void;
  onSubmit: () => void;
}

export const StreamingLinksForm = ({ streamingLinks, onStreamingLinksChange, onSubmit }: StreamingLinksFormProps) => {
  return (
    <Card className="bg-card border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Video className="w-4 h-4 text-primary" />
          Streaming Platform Links
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-[#9146FF]/10 text-[#9146FF] rounded-full">
              <Twitch className="w-4 h-4" />
            </div>
            <Input
              placeholder="Twitch URL"
              value={streamingLinks.twitch}
              onChange={(e) => onStreamingLinksChange({ ...streamingLinks, twitch: e.target.value })}
              className="flex-1"
            />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-[#FF0000]/10 text-[#FF0000] rounded-full">
              <Youtube className="w-4 h-4" />
            </div>
            <Input
              placeholder="YouTube URL"
              value={streamingLinks.youtube}
              onChange={(e) => onStreamingLinksChange({ ...streamingLinks, youtube: e.target.value })}
              className="flex-1"
            />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-[#000000]/10 text-black rounded-full dark:text-white">
              <ArrowBigDown className="w-4 h-4" />
            </div>
            <Input
              placeholder="TikTok URL"
              value={streamingLinks.tiktok}
              onChange={(e) => onStreamingLinksChange({ ...streamingLinks, tiktok: e.target.value })}
              className="flex-1"
            />
          </div>
          
          <Button 
            onClick={onSubmit}
            className="mt-2 w-full sm:w-auto sm:self-end"
          >
            Update Streaming Links
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
