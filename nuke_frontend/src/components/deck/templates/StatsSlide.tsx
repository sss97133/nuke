import React from 'react';
import type { SlideTemplateProps, StatsContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function StatsSlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as StatsContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`} style={{ position: 'relative' }}>
      {c.hero_image && (
        <img
          className="dk-hero-bg"
          src={c.hero_image}
          alt=""
          style={{ opacity: c.hero_opacity ?? 0.15 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
        <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

        <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

        {c.stats && c.stats.length > 0 && (
          <div className="dk-stat-row">
            {c.stats.map((stat, i) => (
              <div key={i} className="dk-stat">
                <div className="dk-stat-num">{stat.num}</div>
                <div className="dk-stat-label">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {c.body?.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {c.sources && c.sources.length > 0 && (
        <div className="dk-source-line">{c.sources.join(' · ')}</div>
      )}
    </div>
  );
}
