
import React, { useState } from 'react';
import { DocContentDisplay } from '../content/DocContentDisplay';
import { NotesSection } from '../content/NotesSection';
import { QuickLinks } from '../guides/QuickLinks';
import { DownloadResources } from '../guides/DownloadResources';
import { RecentUpdates } from '../guides/RecentUpdates';
import { CoreDocumentation } from '../guides/CoreDocumentation';
import { DocContent, getDocContents } from '../guides/docContentUtils';

export const GuidesTab = () => {
  const [activeDoc, setActiveDoc] = useState<DocContent | null>(null);
  const docContents = getDocContents();

  const handleDocLinkClick = (path: string) => {
    if (docContents[path]) {
      setActiveDoc({
        path,
        title: docContents[path].title,
        content: docContents[path].content,
        section: docContents[path].section
      });
    }
  };

  const handleBackClick = () => {
    setActiveDoc(null);
  };

  if (activeDoc) {
    return (
      <DocContentDisplay 
        title={activeDoc.title}
        content={activeDoc.content}
        onBack={handleBackClick}
        section={activeDoc.section}
      />
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-6">
        <NotesSection />
        <CoreDocumentation onDocLinkClick={handleDocLinkClick} />
        <RecentUpdates />
      </div>
      
      <div className="space-y-6">
        <QuickLinks onDocLinkClick={handleDocLinkClick} />
        <DownloadResources onDocLinkClick={handleDocLinkClick} />
      </div>
    </div>
  );
};
