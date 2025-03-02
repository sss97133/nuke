
import React from 'react';
import { ExternalLink } from 'lucide-react';

interface DocLinkProps { 
  href: string; 
  children: React.ReactNode;
}

export const DocLink = ({ href, children }: DocLinkProps) => (
  <a 
    href={href} 
    target="_blank" 
    rel="noopener noreferrer"
    className="flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted transition-colors"
  >
    {children}
    <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
  </a>
);
