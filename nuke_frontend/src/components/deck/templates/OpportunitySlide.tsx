import React from 'react';
import type { SlideTemplateProps, OpportunityContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function OpportunitySlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as OpportunityContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`}>
      {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
      <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

      {c.body?.map((para, i) => (
        <p key={i}>{para}</p>
      ))}

      {c.cards && c.cards.length > 0 && (
        <div className={c.cards.length === 3 ? 'dk-grid-3' : 'dk-grid-2'}>
          {c.cards.map((card, i) => {
            const isBrand = card.bg === 'ford-blue' || card.bg === 'brand';
            const isLarge = card.size === 'large';
            return (
              <div key={i} className={`dk-card ${isBrand ? 'dk-card--brand' : ''} ${isLarge ? 'dk-card--large' : ''}`}>
                <h4>{card.title}</h4>
                <p style={{ whiteSpace: 'pre-line' }}>{card.body}</p>
              </div>
            );
          })}
        </div>
      )}

      {c.images && c.images.length > 0 && (
        <div className="dk-image-strip">
          {c.images.map((img, i) => (
            <div key={i}>
              <img src={img.url} alt={img.caption || ''} />
              {img.caption && <div className="dk-img-caption">{img.caption}</div>}
            </div>
          ))}
        </div>
      )}

      {c.footer && (
        <p style={{ marginTop: 32, fontSize: 'var(--dk-text-md)' }}>{c.footer}</p>
      )}

      {c.sources && c.sources.length > 0 && (
        <div className="dk-source-line">{c.sources.join(' · ')}</div>
      )}
    </div>
  );
}
