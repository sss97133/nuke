import React from 'react';
import type { SlideTemplateProps, AskContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function AskSlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as AskContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`}>
      {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
      <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

      {c.cards && c.cards.length > 0 && (
        <div className="dk-grid-3">
          {c.cards.map((card, i) => (
            <div key={i} className="dk-card">
              <h4>{card.title}</h4>
              <p style={{ whiteSpace: 'pre-line' }}>{card.body}</p>
              {card.cost && (
                <div style={{ fontSize: 'var(--dk-text-base)', marginTop: 16, fontWeight: 600, color: 'var(--dk-brand-accent)' }}>
                  {card.cost}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {c.footer && (
        <p style={{ marginTop: 32, fontSize: 'var(--dk-text-md)' }}>{c.footer}</p>
      )}

      {c.benchmarks && (
        <div className="dk-source-line">{c.benchmarks}</div>
      )}

      {c.sources && c.sources.length > 0 && (
        <div className="dk-source-line">{c.sources.join(' · ')}</div>
      )}
    </div>
  );
}
