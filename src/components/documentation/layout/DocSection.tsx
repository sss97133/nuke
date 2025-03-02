
import React from 'react';

interface DocSectionProps { 
  icon: React.ReactNode; 
  title: string; 
  children: React.ReactNode;
}

export const DocSection = ({ icon, title, children }: DocSectionProps) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="text-xl font-semibold">{title}</h2>
    </div>
    <div>{children}</div>
  </div>
);
