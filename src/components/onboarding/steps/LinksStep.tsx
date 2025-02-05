import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SocialLinks, StreamingLinks } from '@/types/profile';

interface LinksStepProps {
  socialLinks: SocialLinks;
  streamingLinks: StreamingLinks;
  onUpdateSocial: (links: SocialLinks) => void;
  onUpdateStreaming: (links: StreamingLinks) => void;
}

export const LinksStep = ({
  socialLinks,
  streamingLinks,
  onUpdateSocial,
  onUpdateStreaming,
}: LinksStepProps) => {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Social Media Links</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="twitter">Twitter</Label>
            <Input
              id="twitter"
              placeholder="Twitter URL"
              value={socialLinks.twitter}
              onChange={(e) =>
                onUpdateSocial({ ...socialLinks, twitter: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram</Label>
            <Input
              id="instagram"
              placeholder="Instagram URL"
              value={socialLinks.instagram}
              onChange={(e) =>
                onUpdateSocial({ ...socialLinks, instagram: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-medium">Streaming Platform Links</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="twitch">Twitch</Label>
            <Input
              id="twitch"
              placeholder="Twitch URL"
              value={streamingLinks.twitch}
              onChange={(e) =>
                onUpdateStreaming({ ...streamingLinks, twitch: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="youtube">YouTube</Label>
            <Input
              id="youtube"
              placeholder="YouTube URL"
              value={streamingLinks.youtube}
              onChange={(e) =>
                onUpdateStreaming({ ...streamingLinks, youtube: e.target.value })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};