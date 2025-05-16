import React from 'react';
import { LinkIcon, Twitter, Instagram, Linkedin, Github } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SocialLinks } from './types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SocialLinksFormProps {
  socialLinks: SocialLinks;
  onSocialLinksChange: (links: SocialLinks) => void;
  onSubmit: () => void;
}

export const SocialLinksForm = ({ socialLinks, onSocialLinksChange, onSubmit }: SocialLinksFormProps) => {
  return (
    <Card className="bg-card border border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-primary" />
          Social Media Links
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-[#1DA1F2]/10 text-[#1DA1F2] rounded-full">
              <Twitter className="w-4 h-4" />
            </div>
            <Input
              placeholder="Twitter URL"
              value={socialLinks.twitter}
              onChange={(e) => onSocialLinksChange({ ...socialLinks, twitter: e.target.value })}
              className="flex-1"
            />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-[#E1306C]/10 text-[#E1306C] rounded-full">
              <Instagram className="w-4 h-4" />
            </div>
            <Input
              placeholder="Instagram URL"
              value={socialLinks.instagram}
              onChange={(e) => onSocialLinksChange({ ...socialLinks, instagram: e.target.value })}
              className="flex-1"
            />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-[#0A66C2]/10 text-[#0A66C2] rounded-full">
              <Linkedin className="w-4 h-4" />
            </div>
            <Input
              placeholder="LinkedIn URL"
              value={socialLinks.linkedin}
              onChange={(e) => onSocialLinksChange({ ...socialLinks, linkedin: e.target.value })}
              className="flex-1"
            />
          </div>
          
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-[#333]/10 text-[#333] rounded-full dark:text-white dark:bg-white/10">
              <Github className="w-4 h-4" />
            </div>
            <Input
              placeholder="GitHub URL"
              value={socialLinks.github}
              onChange={(e) => onSocialLinksChange({ ...socialLinks, github: e.target.value })}
              className="flex-1"
            />
          </div>
          
          <Button 
            onClick={onSubmit}
            className="mt-2 w-full sm:w-auto sm:self-end"
          >
            Update Social Links
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
