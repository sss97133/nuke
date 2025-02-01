import React from 'react';
import { LinkIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SocialLinks } from './types';

interface SocialLinksFormProps {
  socialLinks: SocialLinks;
  onSocialLinksChange: (links: SocialLinks) => void;
  onSubmit: () => void;
}

export const SocialLinksForm = ({ socialLinks, onSocialLinksChange, onSubmit }: SocialLinksFormProps) => {
  return (
    <div className="mb-6 bg-white p-3 border border-[#999]">
      <div className="flex items-center gap-2 mb-3">
        <LinkIcon className="w-4 h-4 text-[#000066]" />
        <h3 className="text-tiny font-mono text-[#333333]">SOCIAL_MEDIA_LINKS</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          placeholder="TWITTER_URL"
          value={socialLinks.twitter}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, twitter: e.target.value })}
          className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
        />
        <Input
          placeholder="INSTAGRAM_URL"
          value={socialLinks.instagram}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, instagram: e.target.value })}
          className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
        />
        <Input
          placeholder="LINKEDIN_URL"
          value={socialLinks.linkedin}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, linkedin: e.target.value })}
          className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
        />
        <Input
          placeholder="GITHUB_URL"
          value={socialLinks.github}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, github: e.target.value })}
          className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
        />
      </div>
      <Button 
        onClick={onSubmit}
        className="mt-3 bg-[#000066] hover:bg-[#000044] text-white text-tiny font-mono"
      >
        UPDATE_SOCIAL_LINKS
      </Button>
    </div>
  );
};