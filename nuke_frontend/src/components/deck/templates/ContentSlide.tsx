import React from 'react';
import type { SlideTemplateProps, ContentSlideContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function ContentSlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as ContentSlideContent;
  const bgClass = bgTypeToClass(bgType);

  return (
    <div className={`dk-slide ${bgClass}`}>
      {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
      <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

      <h2 dangerouslySetInnerHTML={{ __html: c.title }} />

      {c.columns && c.columns.length > 0 && (
        <div className="dk-grid-2">
          {c.columns.map((col, i) => (
            <div key={i}>
              {col.title && (
                <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {col.title}
                </h4>
              )}
              {col.subtitle && (
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--dk-muted)', marginBottom: 8 }}>
                  {col.subtitle}
                </div>
              )}
              {col.items && (
                <ul>
                  {col.items.map((item, j) => (
                    <li key={j} dangerouslySetInnerHTML={{ __html: item }} />
                  ))}
                </ul>
              )}
              {col.footer && (
                <p style={{ fontSize: 'var(--dk-text-base)', marginTop: 16, fontStyle: 'italic' }}>{col.footer}</p>
              )}
              {col.calendar && col.calendar.length > 0 && (
                <table style={{ marginTop: 16 }}>
                  <thead><tr><th>Month</th><th>Event</th></tr></thead>
                  <tbody>
                    {col.calendar.map((row, j) => (
                      <tr key={j}>
                        <td style={{ fontWeight: 600, width: 100 }}>{row.month}</td>
                        <td>{row.event}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {c.sources && c.sources.length > 0 && (
        <div className="dk-source-line">{c.sources.join(' · ')}</div>
      )}
    </div>
  );
}
