import React from 'react';
import type { SlideTemplateProps, ProofContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function ProofSlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as ProofContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`}>
      {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
      <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

      {c.body?.map((para, i) => (
        <p key={i}>{para}</p>
      ))}

      {c.images && c.images.length > 0 && (
        <div className={`dk-image-strip`} style={{ gridTemplateColumns: `repeat(${Math.min(c.images.length, 4)}, 1fr)` }}>
          {c.images.map((img, i) => (
            <div key={i}>
              <img src={img.url} alt={img.caption || ''} />
              {img.caption && <div className="dk-img-caption">{img.caption}</div>}
            </div>
          ))}
        </div>
      )}

      {c.quote && (
        <div className="dk-quote">
          <div className="dk-quote-text">"{c.quote.text}"</div>
          <div className="dk-quote-attr">{c.quote.attribution}</div>
        </div>
      )}

      {c.cards && c.cards.length > 0 && (
        <div className="dk-grid-2">
          {c.cards.map((card, i) => {
            const isBrand = card.bg === 'ford-blue' || card.bg === 'brand';
            return (
              <div key={i} className={`dk-card ${isBrand ? 'dk-card--brand' : ''}`}>
                <h4>{card.title}</h4>
                <p style={{ whiteSpace: 'pre-line' }}>{card.body}</p>
              </div>
            );
          })}
        </div>
      )}

      {c.sources && c.sources.length > 0 && (
        <div className="dk-source-line">{c.sources.join(' · ')}</div>
      )}
    </div>
  );
}
