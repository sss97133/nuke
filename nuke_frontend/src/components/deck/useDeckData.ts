/**
 * useDeckData — fetches deck slides + referenced organization brand data.
 * Slides come from deck_slides table, org brand data from organizations.brand_design_language.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

export interface DeckSlide {
  id: string;
  deck_id: string;
  slide_index: number;
  slide_type: string;
  bg_type: 'light' | 'dark' | 'ford-blue' | 'marsh';
  content: Record<string, any>;
  entity_slugs: string[];
  updated_at: string;
  updated_by: string | null;
}

export interface OrgBrand {
  slug: string;
  name: string;
  brand_design_language: Record<string, any> | null;
}

interface DeckData {
  slides: DeckSlide[];
  orgs: Map<string, OrgBrand>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeckData(deckId: string): DeckData {
  const [slides, setSlides] = useState<DeckSlide[]>([]);
  const [orgs, setOrgs] = useState<Map<string, OrgBrand>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch slides
      const { data: slideData, error: slideErr } = await supabase
        .from('deck_slides')
        .select('*')
        .eq('deck_id', deckId)
        .order('slide_index');

      if (slideErr) throw slideErr;
      if (!slideData || slideData.length === 0) {
        setError('No slides found for this deck');
        setSlides([]);
        setLoading(false);
        return;
      }

      setSlides(slideData as DeckSlide[]);

      // Collect all unique entity slugs
      const allSlugs = new Set<string>();
      for (const slide of slideData) {
        if (slide.entity_slugs) {
          for (const slug of slide.entity_slugs) allSlugs.add(slug);
        }
        // Also check content.logos array for cover/close slides
        if (slide.content?.logos) {
          for (const s of slide.content.logos) allSlugs.add(s);
        }
        // Check partner_cards entities
        if (slide.content?.partner_cards) {
          for (const card of slide.content.partner_cards) {
            if (card.entity) allSlugs.add(card.entity);
          }
        }
      }

      // Fetch org brand data for all referenced entities
      if (allSlugs.size > 0) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('slug, name, brand_design_language')
          .in('slug', Array.from(allSlugs));

        const orgMap = new Map<string, OrgBrand>();
        if (orgData) {
          for (const org of orgData) {
            orgMap.set(org.slug, org as OrgBrand);
          }
        }
        setOrgs(orgMap);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load deck');
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { slides, orgs, loading, error, refetch: fetchData };
}

/**
 * Save a slide's content (single field update with attribution).
 */
export async function saveDeckSlide(
  slideId: string,
  updates: Partial<Pick<DeckSlide, 'content' | 'bg_type' | 'entity_slugs'>>
): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('deck_slides')
    .update({ ...updates, updated_by: user?.id || null })
    .eq('id', slideId);
  return { error: error?.message || null };
}
