import React from 'react';
import type { SlideTemplateProps, DividerContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function DividerSlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as DividerContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`} style={{ textAlign: 'center', alignItems: 'center' }}>
      {c.section_label && (
        <h3>{c.section_label}</h3>
      )}
      {c.number && (
        <div style={{ fontSize: 'var(--dk-text-5xl)', fontWeight: 200, opacity: 0.15, marginBottom: 'var(--dk-space-3)' }}>
          {c.number}
        </div>
      )}
      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />
    </div>
  );
}
