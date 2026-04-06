/**
 * DeckSlide — routes slide_type to the correct template component.
 * Falls back to raw HTML rendering for slides that haven't been migrated.
 */
import React from 'react';
import type { DeckSlide as DeckSlideType, OrgBrand } from './useDeckData';
import type { SlideTemplateProps } from './deckTypes';
import {
  CoverSlide,
  ThesisSlide,
  OpportunitySlide,
  StatsSlide,
  ProofSlide,
  ComparisonSlide,
  PartnersSlide,
  ContentSlide,
  AskSlide,
  GallerySlide,
  CloseSlide,
  ProductSlide,
  DividerSlide,
} from './templates';

interface Props {
  slide: DeckSlideType;
  orgs: Map<string, OrgBrand>;
  canEdit: boolean;
  onUpdated?: () => void;
}

/** Map slide_type (including legacy aliases) → template component */
const TEMPLATE_MAP: Record<string, React.ComponentType<SlideTemplateProps>> = {
  cover: CoverSlide,
  thesis: ThesisSlide,
  opportunity: OpportunitySlide,
  value: OpportunitySlide,          // alias
  stats: StatsSlide,
  island: StatsSlide,               // alias
  proof: ProofSlide,
  comparison: ComparisonSlide,
  landscape: ComparisonSlide,       // alias
  precedent: ComparisonSlide,       // alias
  competitive: ComparisonSlide,     // alias
  partners: PartnersSlide,
  content: ContentSlide,
  ask: AskSlide,
  gallery: GallerySlide,
  close: CloseSlide,
  product: ProductSlide,
  divider: DividerSlide,
};

export default function DeckSlide({ slide, orgs, canEdit }: Props) {
  const Template = TEMPLATE_MAP[slide.slide_type];

  // If we have a template and structured content beyond just html, use the template
  const hasStructuredContent = Object.keys(slide.content || {}).some(k => k !== 'html');

  if (Template && hasStructuredContent) {
    return (
      <Template
        content={slide.content}
        bgType={slide.bg_type}
        slideIndex={slide.slide_index}
        orgs={orgs}
        canEdit={canEdit}
      />
    );
  }

  // Fallback: raw HTML rendering (legacy v2 slides)
  const html = slide.content?.html;
  if (!html) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0efe9' }}>
        <p style={{ color: '#777', fontSize: 14 }}>Slide {slide.slide_index}: no content</p>
      </div>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
