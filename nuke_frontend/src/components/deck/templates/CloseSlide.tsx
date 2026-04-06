import React from 'react';
import type { SlideTemplateProps, CloseContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';
import { getLogoForBg } from '../deckUtils';

export default function CloseSlide({ content, bgType, slideIndex, orgs }: SlideTemplateProps) {
  const c = content as CloseContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`} style={{ textAlign: 'center', alignItems: 'center' }}>
      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

      {c.body?.map((para, i) => (
        <p key={i} style={{ textAlign: 'center', maxWidth: 600 }}>{para}</p>
      ))}

      {c.next_step && (
        <div style={{
          marginTop: 48,
          padding: '16px 32px',
          fontSize: 'var(--dk-text-md)',
          letterSpacing: 2,
          textTransform: 'uppercase',
          fontWeight: 500,
        }}>
          {c.next_step}
        </div>
      )}

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

      {c.confidential && (
        <div className="dk-conf">{c.confidential}</div>
      )}
    </div>
  );
}
