import React from 'react';
import type { SlideTemplateProps, GalleryContent } from '../deckTypes';
import { bgTypeToClass } from '../deckTypes';

export default function GallerySlide({ content, bgType, slideIndex }: SlideTemplateProps) {
  const c = content as GalleryContent;
  const bgClass = bgTypeToClass(bgType);

  // Dynamic grid: 2 columns if <=4 images, 3 if 5-9, 4 if 10+
  const cols = (c.images?.length ?? 0) >= 10 ? 4 : (c.images?.length ?? 0) >= 5 ? 3 : 2;

  return (
    <div className={`dk-slide ${bgClass}`}>
      {c.section_label && <div className="dk-slide-mark">{c.section_label}</div>}
      <div className="dk-slide-num">{String(slideIndex).padStart(2, '0')}</div>

      {c.images && c.images.length > 0 && (
        <div className="dk-image-strip" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {c.images.map((img, i) => (
            <div key={i}>
              <img src={img.url} alt={img.caption || ''} />
              {img.caption && <div className="dk-img-caption">{img.caption}</div>}
            </div>
          ))}
        </div>
      )}

      {c.credits && (
        <div className="dk-source-line">{c.credits}</div>
      )}
    </div>
  );
}
