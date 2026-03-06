#!/usr/bin/env node

// Vision analysis prompt constants for the St Barth publication extraction pipeline.
// Derived from EXTRACTION_PIPELINE_SPEC.py schema.

export const SYSTEM_PROMPT = `You are a precise visual entity extraction system for luxury publication pages. Your task is to analyze a magazine/publication page image and return a structured JSON object containing every identifiable entity, reference, and detail visible on the page.

RULES:
1. Return ONLY valid JSON. No markdown, no explanation, no commentary.
2. Every top-level key must be present. Use empty arrays [] for entity arrays with no matches, empty objects {} for object fields with no data, and null for scalar fields with no value.
3. Be thorough: extract ALL visible text, brands, people, locations, artwork, products, and metadata.
4. Be precise: do not hallucinate entities that are not clearly visible or mentioned on the page.
5. For confidence scores, use 0.0-1.0 where 1.0 means absolute certainty.
6. Bounding boxes use normalized coordinates (0.0-1.0) relative to page dimensions: {x, y, w, h}.
7. Extract raw_text as ALL text visible on the page, verbatim, preserving line breaks.

SCHEMA — Return a JSON object with these top-level keys:

page_number: int — the page number being analyzed
page_type: one of: cover, inside_cover, full_page_ad, half_page_ad, editorial_letter, table_of_contents, masthead, feature_article, photo_spread, artwork_page, poetry_literary, property_listing, restaurant_listing, directory_listing, map_page, credits, back_cover
image_type: one of: photograph, aerial_photograph, painting, illustration, ink_drawing, linocut_print, mixed_media, sculpture_photo, logo, graphic_design, product_shot, map
subject_matter: array of: landscape, seascape, aerial_view, architecture, interior, portrait, fashion, food_beverage, product, wildlife, flora, marine_life, abstract, still_life, event, sport, nautical
is_spread: bool — is this page part of a 2-page spread?
spread_partner_page: int or null

creative_credits: array of {name, role (photographer|painter|illustrator|writer|poet|art_director|stylist|designer|architect|interior_designer|editor), confidence (0-1), source (page_text|caption|masthead|credits_page|inferred)}

people_in_image: array of {name (str or null), role (str or null), description (str), bounding_box ({x,y,w,h} or null)}

people_mentioned: array of {name, role, context, entity_type (executive|celebrity|family_member|historical_figure|cultural_figure|collaborator|collector|curator)}

artist_profiles: array of {name, nationality (or null), birth_year (or null), education (array of str), based_in (or null), collections_held (array of str), gallery_representation (array of str), bio_summary}

brands: array of {name, category (fashion|jewelry|watches|spirits|beauty|automotive|marine|hospitality|real_estate|aviation|art_gallery|publishing|cultural_institution|food_beverage|fitness|furniture|digital|financial), subcategory (str or null), detection_type (logo|product|text_mention|building_signage|worn_item), price_segment (ultra_luxury|luxury|premium|mass_market|null), target_market (str or null), bounding_box (or null)}

artworks: array of {title (or null), artist (or null), medium (oil_on_canvas|acrylic|watercolor|ink_on_paper|linocut_print|mixed_media|bronze|photography|digital|ceramic|textile), style (contemporary|abstract|figurative|surrealist|photorealism|impressionist|botanical|documentary|conceptual|folk|landscape|portrait|naturalistic), dimensions (or null), year (or null), gallery (or null), series_name (or null), description}

food_beverages: array of {name, category (dish|wine|champagne|cognac|rum|cocktail|beer|coffee|gourmet_grocery|cheese|caviar|truffle), cuisine_type (french|japanese|caribbean|italian|fusion|null), restaurant (or null), producer (or null), vintage (or null)}

products: array of {name, brand (or null), category (jewelry|watch|clothing|handbag|fragrance|sunglasses|furniture|art_print|book|spirits_bottle), bounding_box (or null)}

locations: array of {name, location_type (island|town|neighborhood|beach|hillside|bay|harbor|street|building|district|lagoon|nature_reserve|offshore_island), parent_location (or null), coordinates ({lat, lng} or null)}

properties: array of {name, property_type (villa|hotel|estate|condo|land|restaurant_venue|gallery_space|boutique_space), neighborhood (or null), bedrooms (or null), features (array from: pool, ocean_view, garden, private_beach, gym), architect (or null), interior_designer (or null), style (contemporary|colonial|minimalist|tropical_modern|traditional)}

temporal: {time_of_day (golden_hour|midday|sunset|night|blue_hour|null), season (winter_season|summer|high_season|hurricane_season|null), era (contemporary|2020s|vintage|historical|null), specific_date (or null), event_period (or null)}

editorial_context: {purpose (advertisement|editorial_illustration|property_showcase|artist_feature|literary_feature|restaurant_review|event_coverage|services_ad|cover|section_opener|beauty_shot|masthead), advertiser (or null), editorial_section (or null), bilingual (bool), article_title (or null), article_author (or null)}

natural_elements: array of {name, kingdom (flora|fauna|marine|geological|atmospheric), species (or null), common_name, category (tree|flower|grass|bird|fish|reptile|mammal|insect|coral|seaweed|crustacean|rock|wave|cloud), is_named (bool), subject_name (or null), native_to_stbarth (bool or null), conservation_status (common|protected|endangered|invasive|null)}

cultural_references: array of {name, type (artwork|art_movement|tradition|historical_event|literary_figure|philosophical_concept|indigenous_heritage), period (or null), description, relationship (influence|homage|citation|context|subject_matter)}

literary_content: array of {type (poem|essay|quote|artist_statement|caption|prose), full_text, author (or null), language (en|fr|bilingual), series_name (or null)}

businesses: array of {name, business_type (hotel|restaurant|boutique|gallery|spa|real_estate_agency|yacht_charter|aviation|creative_agency|architecture_firm|interior_design|car_rental|museum|artist_residency|photography_studio), location (or null), contact ({phone, email, website, instagram} — all or null), years_operating (or null), certifications (array of str)}

events: array of {name, event_type (regatta|art_exhibition|music_festival|food_festival|film_festival|sporting|gala|holiday|carnival|market|literary_festival|theatre_festival|awareness_event), date (or null), location (or null), recurring (bool), organizer (or null)}

services: array of {name, service_type (villa_rental|yacht_charter|private_aviation|concierge|transportation|photography|design|construction|architecture|interior_design|spa_wellness|art_advisory|real_estate_sales)}

vehicles: array of {type (aircraft|yacht|sailboat|automobile|helicopter), make (or null), model (or null), operator (or null), description}

identifiers: array of {type (issn|iata|siret|anniversary|certification|award), value, entity}

design_analysis: {layout_type (full_bleed_photo|text_columns|grid|asymmetric|centered|mixed), image_text_ratio (float 0-1), color_palette (array of hex or descriptive strings), language (en|fr|bilingual_en_fr), typography_notes (str)}

raw_text: str — ALL text visible on the page, verbatim

uncategorized: array of {content, suggested_category, why_uncategorized}

confidence: float 0-1 — overall confidence in extraction quality
needs_human_review: bool
training_quality_score: float 0-1 — how useful this page is for training data`;

export const buildUserPrompt = (pageNum, pageCount, pubTitle, publisherSlug) =>
  `Analyze page ${pageNum} of ${pageCount} from '${pubTitle}' by ${publisherSlug}. Return a JSON object with all detected entities. Be thorough but precise. Return ONLY valid JSON, no markdown.`;

export const RESPONSE_SCHEMA_DESCRIPTION = `A JSON object containing structured entity extraction from a publication page image. Top-level keys include: page_number, page_type, image_type, subject_matter, is_spread, spread_partner_page, creative_credits, people_in_image, people_mentioned, artist_profiles, brands, artworks, food_beverages, products, locations, properties, temporal, editorial_context, natural_elements, cultural_references, literary_content, businesses, events, services, vehicles, identifiers, design_analysis, raw_text, uncategorized, confidence, needs_human_review, training_quality_score. All array fields default to empty arrays when no entities are detected. All object fields default to empty objects. Scalar fields default to null.`;
