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
    <div className="bg-white p-3 border border-[#999]">
      <div className="flex items-center gap-2 mb-3">
        <Video className="w-4 h-4 text-[#000066]" />
        <h3 className="text-tiny font-mono text-[#333333]">STREAMING_PLATFORM_LINKS</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          placeholder="TWITCH_URL"
          value={streamingLinks.twitch}
          onChange={(e) => onStreamingLinksChange({ ...streamingLinks, twitch: e.target.value })}
          className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
        />
        <Input
          placeholder="YOUTUBE_URL"
          value={streamingLinks.youtube}
          onChange={(e) => onStreamingLinksChange({ ...streamingLinks, youtube: e.target.value })}
          className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
        />
        <Input
          placeholder="TIKTOK_URL"
          value={streamingLinks.tiktok}
          onChange={(e) => onStreamingLinksChange({ ...streamingLinks, tiktok: e.target.value })}
          className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
        />
      </div>
      <Button 
        onClick={onSubmit}
        className="mt-3 bg-[#000066] hover:bg-[#000044] text-white text-tiny font-mono"
      >
        UPDATE_STREAMING_LINKS
      </Button>
    </div>
  );
};