import React from 'react';
import type { SlideTemplateProps, PartnersContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';
import { getLogoForBg } from '../deckUtils';

export default function PartnersSlide({ content, bgType, slideIndex, orgs }: SlideTemplateProps) {
  const c = content as PartnersContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`}>
      {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
      <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

      {c.partner_cards && c.partner_cards.length > 0 && (
        <div className="dk-grid-3" style={{ gridTemplateColumns: c.partner_cards.length <= 4 ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)' }}>
          {c.partner_cards.map((card, i) => {
            const org = card.entity ? orgs.get(card.entity) : null;
            const logo = org ? getLogoForBg(org.brand_design_language, bgType as any) : null;
            return (
              <div key={i} className="dk-card" style={card.accent ? { borderTop: `3px solid ${card.accent}` } : undefined}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    {card.role && (
                      <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--dk-muted)', marginBottom: 4 }}>
                        {card.role}
                      </div>
                    )}
                    <h4>{card.title}</h4>
                  </div>
                  {logo && (
                    <img src={logo} alt={org?.name || ''} style={{ height: 24, objectFit: 'contain', opacity: 0.7 }} />
                  )}
                </div>
                <p style={{ whiteSpace: 'pre-line' }}>{card.body}</p>
                {card.multi_logos && card.multi_logos.length > 0 && (
                  <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                    {card.multi_logos.map((slug) => {
                      const o = orgs.get(slug);
                      const l = o ? getLogoForBg(o.brand_design_language, bgType as any) : null;
                      return l ? (
                        <img key={slug} src={l} alt={o?.name || slug} style={{ height: 18, objectFit: 'contain', opacity: 0.6 }} />
                      ) : (
                        <span key={slug} style={{ fontSize: 10, color: 'var(--dk-muted)' }}>{o?.name || slug}</span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
