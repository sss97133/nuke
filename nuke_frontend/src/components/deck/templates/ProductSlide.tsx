import React from 'react';
import type { SlideTemplateProps, ProductContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function ProductSlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as ProductContent;
  const bgClass = bgTypeToClass(bgType);

  // Split images: first is large hero, rest are half
  const heroImage = c.images?.[0];
  const halfImages = c.images?.slice(1) || [];

  return (
    <div className={`dk-slide ${bgClass}`}>
      {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
      <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

      <div className="dk-grid-2">
        <div>
          {c.body?.map((para, i) => (
            <p key={i}>{para}</p>
          ))}

          {c.quote && (
            <div className="dk-quote">
              {c.quote.avatar && (
                <img className="dk-quote-avatar" src={c.quote.avatar} alt="" />
              )}
              <div className="dk-quote-text">"{c.quote.text}"</div>
              <div className="dk-quote-attr">{c.quote.attribution}</div>
            </div>
          )}
        </div>

        <div>
          {heroImage && (
            <img
              src={heroImage.url}
              alt={heroImage.caption || ''}
              style={{ width: '100%', height: 320, objectFit: 'cover', marginBottom: 'var(--dk-space-2)' }}
            />
          )}
          {halfImages.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${halfImages.length}, 1fr)`, gap: 'var(--dk-space-2)' }}>
              {halfImages.map((img, i) => (
                <img key={i} src={img.url} alt={img.caption || ''} style={{ width: '100%', height: 160, objectFit: 'cover' }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {c.footer && (
        <p style={{ marginTop: 32, fontSize: 'var(--dk-text-md)' }}>{c.footer}</p>
      )}

      {c.sources && c.sources.length > 0 && (
        <div className="dk-source-line">{c.sources.join(' · ')}</div>
      )}
    </div>
  );
}
