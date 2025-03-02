
import React from 'react';
import { ExternalLink, ArrowRight } from 'lucide-react';

interface DocLinkProps { 
  href: string; 
  children: React.ReactNode;
  onClick?: (path: string) => void;
  isExternal?: boolean;
}

export const DocLink = ({ href, children, onClick, isExternal = false }: DocLinkProps) => {
  const handleClick = (e: React.MouseEvent) => {
    if (!isExternal && onClick) {
      e.preventDefault();
      onClick(href);
    }
  };

  return (
    <a 
      href={href} 
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="flex items-center gap-2 py-2 px-3 rounded-md hover:bg-muted transition-colors"
      onClick={handleClick}
    >
      {children}
      {isExternal ? (
        <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
      ) : (
        <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground" />
      )}
    </a>
  );
};
