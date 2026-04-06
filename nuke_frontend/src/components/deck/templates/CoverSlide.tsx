import React from 'react';
import type { SlideTemplateProps } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';
import { getLogoForBg } from '../deckUtils';
import type { CoverContent } from '../deckTypes';

export default function CoverSlide({ content, bgType, slideIndex, orgs }: SlideTemplateProps) {
  const c = content as CoverContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`} style={{ padding: 0, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      {c.hero_image && (
        <img
          className="dk-hero-bg"
          src={c.hero_image}
          alt=""
          style={{ opacity: c.hero_opacity ?? 0.35 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1, padding: 'var(--dk-slide-pad)' }}>
        <div style={{ fontSize: 'var(--dk-text-sm)', letterSpacing: 5, textTransform: 'uppercase', color: 'var(--dk-sand)', marginBottom: 48 }}>
          {c.prepared_for}
        </div>
        <h1
          style={{ fontSize: 'var(--dk-text-4xl)', fontWeight: 300, letterSpacing: -2, color: '#fff', marginBottom: 8 }}
          dangerouslySetInnerHTML={{ __html: c.title }}
        />
        <div style={{ fontSize: 'var(--dk-text-md)', letterSpacing: 5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginTop: 12 }}>
          {c.subtitle}
        </div>
        {c.logos && c.logos.length > 0 && (
          <div className="dk-logo-bar">
            {c.logos.map((slug) => {
              const org = orgs.get(slug);
              const logo = getLogoForBg(org?.brand_design_language, bgType as any);
              if (!logo) return null;
              return (
                <img
                  key={slug}
                  src={logo}
                  alt={org?.name || slug}
                  style={{ height: slug === c.logos[0] ? 44 : 28, objectFit: 'contain' }}
                />
              );
            })}
          </div>
        )}
      </div>
      {c.confidential && (
        <div className="dk-conf" style={{ color: 'rgba(255,255,255,0.3)' }}>Confidential</div>
      )}
    </div>
  );
}
