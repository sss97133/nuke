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
    <div className="mb-4 bg-[#FFFFFF] p-2 border border-[#403E43]">
      <div className="flex items-center gap-2 mb-2">
        <LinkIcon className="w-3 h-3 text-[#222222]" />
        <h3 className="text-[10px] font-mono text-[#222222]">SOCIAL_MEDIA_LINKS</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          placeholder="TWITTER_URL"
          value={socialLinks.twitter}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, twitter: e.target.value })}
          className="text-[10px] font-mono bg-[#C8C8C9] border-[#8A898C] h-6"
        />
        <Input
          placeholder="INSTAGRAM_URL"
          value={socialLinks.instagram}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, instagram: e.target.value })}
          className="text-[10px] font-mono bg-[#C8C8C9] border-[#8A898C] h-6"
        />
        <Input
          placeholder="LINKEDIN_URL"
          value={socialLinks.linkedin}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, linkedin: e.target.value })}
          className="text-[10px] font-mono bg-[#C8C8C9] border-[#8A898C] h-6"
        />
        <Input
          placeholder="GITHUB_URL"
          value={socialLinks.github}
          onChange={(e) => onSocialLinksChange({ ...socialLinks, github: e.target.value })}
          className="text-[10px] font-mono bg-[#C8C8C9] border-[#8A898C] h-6"
        />
      </div>
      <Button 
        onClick={onSubmit}
        className="mt-2 bg-[#403E43] hover:bg-[#222222] text-[#FFFFFF] text-[10px] font-mono h-6"
      >
        UPDATE_SOCIAL_LINKS
      </Button>
    </div>
  );
};