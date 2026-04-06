import React from 'react';
import type { SlideTemplateProps, ThesisContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function ThesisSlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as ThesisContent;
  const bgClass = bgTypeToClass(bgType);

  const calloutBrand = c.callout?.bg === 'ford-blue' || c.callout?.bg === 'brand';

  return (
    <div className={`dk-slide ${bgClass}`} style={{ position: 'relative' }}>
      {c.hero_image && (
        <img
          className="dk-hero-bg"
          src={c.hero_image}
          alt=""
          style={{ opacity: c.hero_opacity ?? 0.1 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {c.section_label && (
          <div className="dk-slide-mark">{c.section_label}</div>
        )}
        <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

        <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

        <div className="dk-grid-2">
          <div>
            {c.body?.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
          {c.callout && (
            <div className={`dk-card ${calloutBrand ? 'dk-card--brand' : ''}`}>
              <h4>{c.callout.title}</h4>
              {c.callout.body?.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
