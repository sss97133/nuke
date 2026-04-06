import React from 'react';
import type { SlideTemplateProps, ComparisonContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';
import { getLogoForBg } from '../deckUtils';

export default function ComparisonSlide({ content, bgType, slideIndex, orgs }: SlideTemplateProps) {
  const c = content as ComparisonContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`} style={{ position: 'relative' }}>
      {c.hero_image && (
        <img
          className="dk-hero-bg"
          src={c.hero_image}
          alt=""
          style={{ opacity: 0.12 }}
        />
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
        <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

        <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

        {c.body?.map((para, i) => (
          <p key={i}>{para}</p>
        ))}

        {/* Bullet items (competitive slide pattern) */}
        {c.items && c.items.length > 0 && (
          <ul style={{ marginBottom: 24 }}>
            {c.items.map((item, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
            ))}
          </ul>
        )}

        {/* Two-column layout */}
        {c.columns && c.columns.length > 0 && (
          <div className="dk-grid-2">
            {c.columns.map((col, i) => (
              <div key={i}>
                {col.title && <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>{col.title}</h4>}
                {col.items && (
                  <ul>
                    {col.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                )}
                {col.table_rows && (
                  <table>
                    <thead><tr><th>Operator</th><th>Fleet</th></tr></thead>
                    <tbody>
                      {col.table_rows.map((row, j) => (
                        <tr key={j}>
                          <td>
                            {row.color && (
                              <span style={{ display: 'inline-block', width: 8, height: 8, background: row.color, borderRadius: '50%', marginRight: 8 }} />
                            )}
                            {row.brand}
                          </td>
                          <td>{row.fleet}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {col.footer && (
                  <p style={{ fontSize: 'var(--dk-text-base)', marginTop: 12, fontStyle: 'italic' }}>{col.footer}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Cards (precedent pattern) */}
        {c.cards && c.cards.length > 0 && (
          <div className="dk-grid-2">
            {c.cards.map((card, i) => {
              const isBrand = card.bg === 'ford-blue' || card.bg === 'brand';
              return (
                <div key={i} className={`dk-card ${isBrand ? 'dk-card--brand' : ''}`}>
                  <h4>{card.title}</h4>
                  {card.table_rows ? (
                    <table>
                      <tbody>
                        {card.table_rows.map((row, j) => (
                          <tr key={j}>
                            <td style={{ fontWeight: 600, width: 100 }}>{row.label}</td>
                            <td>{row.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ whiteSpace: 'pre-line' }}>{card.body}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Hotel comparison table */}
        {c.hotel_table && c.hotel_table.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <table>
              <thead><tr><th>Hotel</th><th>Current Guest Fleet</th></tr></thead>
              <tbody>
                {c.hotel_table.map((row, i) => {
                  const org = orgs.get(row.entity);
                  const logo = getLogoForBg(org?.brand_design_language, bgType as any);
                  return (
                    <tr key={i}>
                      <td style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {logo && <img src={logo} alt="" style={{ height: 18, objectFit: 'contain' }} />}
                        {org?.name || row.entity}
                      </td>
                      <td>{row.fleet}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {c.hotel_footer && (
              <p style={{ fontSize: 'var(--dk-text-base)', marginTop: 12, fontStyle: 'italic' }}>{c.hotel_footer}</p>
            )}
          </div>
        )}

        {/* Images strip */}
        {(content as any).images && (content as any).images.length > 0 && (
          <div className="dk-image-strip" style={{ gridTemplateColumns: `repeat(${Math.min((content as any).images.length, 4)}, 1fr)` }}>
            {(content as any).images.map((img: any, i: number) => (
              <div key={i}>
                <img src={img.url} alt={img.caption || ''} />
                {img.caption && <div className="dk-img-caption">{img.caption}</div>}
              </div>
            ))}
          </div>
        )}

        {c.footer && (
          <p style={{ marginTop: 24, fontSize: 'var(--dk-text-md)' }}>{c.footer}</p>
        )}

        {c.hero_caption && (
          <div className="dk-source-line">{c.hero_caption}</div>
        )}
      </div>

      {c.sources && c.sources.length > 0 && (
        <div className="dk-source-line">{c.sources.join(' · ')}</div>
      )}
    </div>
  );
}
