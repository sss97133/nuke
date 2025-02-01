import React from 'react';
import { Video } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StreamingLinks } from './types';

interface StreamingLinksFormProps {
  streamingLinks: StreamingLinks;
  onStreamingLinksChange: (links: StreamingLinks) => void;
  onSubmit: () => void;
}

export const StreamingLinksForm = ({ streamingLinks, onStreamingLinksChange, onSubmit }: StreamingLinksFormProps) => {
  return (
    <div className="bg-[#FFFFFF] p-2 border border-[#403E43]">
      <div className="flex items-center gap-2 mb-2">
        <Video className="w-3 h-3 text-[#222222]" />
        <h3 className="text-[10px] font-mono text-[#222222]">STREAMING_PLATFORM_LINKS</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          placeholder="TWITCH_URL"
          value={streamingLinks.twitch}
          onChange={(e) => onStreamingLinksChange({ ...streamingLinks, twitch: e.target.value })}
          className="text-[10px] font-mono bg-[#C8C8C9] border-[#8A898C] h-6"
        />
        <Input
          placeholder="YOUTUBE_URL"
          value={streamingLinks.youtube}
          onChange={(e) => onStreamingLinksChange({ ...streamingLinks, youtube: e.target.value })}
          className="text-[10px] font-mono bg-[#C8C8C9] border-[#8A898C] h-6"
        />
        <Input
          placeholder="TIKTOK_URL"
          value={streamingLinks.tiktok}
          onChange={(e) => onStreamingLinksChange({ ...streamingLinks, tiktok: e.target.value })}
          className="text-[10px] font-mono bg-[#C8C8C9] border-[#8A898C] h-6"
        />
      </div>
      <Button 
        onClick={onSubmit}
        className="mt-2 bg-[#403E43] hover:bg-[#222222] text-[#FFFFFF] text-[10px] font-mono h-6"
      >
        UPDATE_STREAMING_LINKS
      </Button>
    </div>
  );
};