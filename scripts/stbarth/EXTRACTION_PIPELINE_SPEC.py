# ============================================================
# ISSUU PAGE EXTRACTION PIPELINE — Full Specification
# ============================================================
# 
# Pipeline: Publication URL → Document Hash → Page Images → 
#           AI Vision Analysis → Structured Training Data → 
#           Supabase (spatial_tags JSONB)
#
# Proven on: Spirit of St Barth N13 (124 pages, 55.8MB)
# Schema validated against: 31 pages deep analysis

## 1. DOCUMENT HASH EXTRACTION

# Issuu CDN pattern:
# https://image.isu.pub/{revisionId}-{publicationId}/jpg/page_{n}.jpg
#
# To get revisionId + publicationId:
# - Load publication URL in browser
# - Extract from embedded JSON in page source
# - Specifically: the reader3 config or __NEXT_DATA__ blob
#
# Example:
# URL: https://issuu.com/spiritofstbarth/docs/spirit_of_stbarth_-_n13_2026
# Hash: 251211191310-f77ff6c64de672a1eeb051a3b218c485
# Pages: 124
# Resolution: 2115x2990 (print quality)

## 2. PAGE IMAGE DOWNLOAD

# Pattern: https://image.isu.pub/{hash}/jpg/page_{n}.jpg
# No auth required. No referrer required (tested both ways).
# Parallel download (10 workers) = ~60 seconds for 124 pages.
# Average page: ~450KB JPEG, 2115x2990px

## 3. AI VISION ANALYSIS — Per-Page Schema

# Each page produces one JSON record with these entity arrays.
# Empty arrays are fine — not every page has every type.

EXTRACTION_SCHEMA = {
    # === IDENTITY ===
    "page_number": "int",
    "page_type": "enum: cover|inside_cover|full_page_ad|half_page_ad|"
                 "editorial_letter|table_of_contents|masthead|feature_article|"
                 "photo_spread|artwork_page|poetry_literary|property_listing|"
                 "restaurant_listing|directory_listing|map_page|credits|back_cover",
    "image_type": "enum: photograph|aerial_photograph|painting|illustration|"
                  "ink_drawing|linocut_print|mixed_media|sculpture_photo|"
                  "logo|graphic_design|product_shot|map",
    "subject_matter": "list of: landscape|seascape|aerial_view|architecture|"
                      "interior|portrait|fashion|food_beverage|product|wildlife|"
                      "flora|marine_life|abstract|still_life|event|sport|nautical",
    "is_spread": "bool — is this page part of a 2-page spread?",
    "spread_partner_page": "int|null",
    
    # === WHO: Creative Team ===
    "creative_credits": [{
        "name": "str",
        "role": "photographer|painter|illustrator|writer|poet|art_director|"
                "stylist|designer|architect|interior_designer|editor",
        "confidence": "float 0-1",
        "source": "page_text|caption|masthead|credits_page|inferred",
    }],
    
    # === WHO: People Depicted ===
    "people_in_image": [{
        "name": "str|null",
        "role": "str|null",
        "description": "str — what they look like, what they're doing",
        "bounding_box": {"x": "float", "y": "float", "w": "float", "h": "float"},
    }],
    
    # === WHO: People Mentioned (NEW from schema revision) ===
    "people_mentioned": [{
        "name": "str",
        "role": "str",
        "context": "str — how/why they're mentioned",
        "entity_type": "executive|celebrity|family_member|historical_figure|"
                       "cultural_figure|collaborator|collector|curator",
    }],
    
    # === WHO: Artist Profiles (NEW — richer than credits) ===
    "artist_profiles": [{
        "name": "str",
        "nationality": "str|null",
        "birth_year": "int|null",
        "education": ["str"],
        "based_in": "str|null",
        "collections_held": ["str — museum/collection names"],
        "gallery_representation": ["str"],
        "bio_summary": "str",
    }],
    
    # === WHAT: Brands ===
    "brands": [{
        "name": "str",
        "category": "fashion|jewelry|watches|spirits|beauty|automotive|marine|"
                    "hospitality|real_estate|aviation|art_gallery|publishing|"
                    "cultural_institution|food_beverage|fitness|furniture|"
                    "digital|financial",
        "subcategory": "str — e.g. haute_couture, swiss_chronograph, cognac",
        "detection_type": "logo|product|text_mention|building_signage|worn_item",
        "price_segment": "ultra_luxury|luxury|premium|mass_market|null",
        "target_market": "str|null",
        "bounding_box": "dict|null",
    }],
    
    # === WHAT: Artworks ===
    "artworks": [{
        "title": "str|null",
        "artist": "str|null",
        "medium": "oil_on_canvas|acrylic|watercolor|ink_on_paper|linocut_print|"
                  "mixed_media|bronze|photography|digital|ceramic|textile",
        "style": "contemporary|abstract|figurative|surrealist|photorealism|"
                 "impressionist|botanical|documentary|conceptual|folk|"
                 "landscape|portrait|naturalistic",
        "dimensions": "str|null",
        "year": "str|null",
        "gallery": "str|null",
        "series_name": "str|null — e.g. 'ABC Collection', 'Falling' series",
        "description": "str",
    }],
    
    # === WHAT: Food & Beverage ===
    "food_beverages": [{
        "name": "str",
        "category": "dish|wine|champagne|cognac|rum|cocktail|beer|coffee|"
                    "gourmet_grocery|cheese|caviar|truffle",
        "cuisine_type": "french|japanese|caribbean|italian|fusion|null",
        "restaurant": "str|null",
        "producer": "str|null — winery, distillery",
        "vintage": "str|null",
    }],
    
    # === WHAT: Products ===
    "products": [{
        "name": "str",
        "brand": "str|null",
        "category": "jewelry|watch|clothing|handbag|fragrance|sunglasses|"
                    "furniture|art_print|book|spirits_bottle",
        "bounding_box": "dict|null",
    }],
    
    # === WHERE: Locations ===
    "locations": [{
        "name": "str",
        "location_type": "island|town|neighborhood|beach|hillside|bay|harbor|"
                         "street|building|district|lagoon|nature_reserve|offshore_island",
        "parent_location": "str|null",
        "coordinates": {"lat": "float", "lng": "float"} or None,
    }],
    
    # === WHERE: Properties ===
    "properties": [{
        "name": "str",
        "property_type": "villa|hotel|estate|condo|land|restaurant_venue|"
                         "gallery_space|boutique_space",
        "neighborhood": "str|null",
        "bedrooms": "int|null",
        "features": ["pool", "ocean_view", "garden", "private_beach", "gym"],
        "architect": "str|null",
        "interior_designer": "str|null",
        "style": "contemporary|colonial|minimalist|tropical_modern|traditional",
    }],
    
    # === WHEN: Temporal ===
    "temporal": {
        "time_of_day": "golden_hour|midday|sunset|night|blue_hour|null",
        "season": "winter_season|summer|high_season|hurricane_season|null",
        "era": "contemporary|2020s|vintage|historical|null",
        "specific_date": "str|null",
        "event_period": "str|null — Bucket Regatta week, Art Week, etc.",
    },
    
    # === WHY: Editorial Context ===
    "editorial_context": {
        "purpose": "advertisement|editorial_illustration|property_showcase|"
                   "artist_feature|literary_feature|restaurant_review|"
                   "event_coverage|services_ad|cover|section_opener|"
                   "beauty_shot|masthead",
        "advertiser": "str|null",
        "editorial_section": "str|null — Art Around Town, Architecture, etc.",
        "bilingual": "bool",
        "article_title": "str|null",
        "article_author": "str|null",
    },
    
    # === NATURE: Flora/Fauna/Ecology (expanded) ===
    "natural_elements": [{
        "name": "str",
        "kingdom": "flora|fauna|marine|geological|atmospheric",
        "species": "str|null — scientific name if identifiable",
        "common_name": "str",
        "category": "tree|flower|grass|bird|fish|reptile|mammal|insect|"
                    "coral|seaweed|crustacean|rock|wave|cloud",
        "is_named": "bool — e.g. 'Martha the bulldog' vs generic parrot",
        "subject_name": "str|null — the individual's name if named",
        "native_to_stbarth": "bool|null",
        "conservation_status": "common|protected|endangered|invasive|null",
    }],
    
    # === CULTURE: References & Context (NEW) ===
    "cultural_references": [{
        "name": "str",
        "type": "artwork|art_movement|tradition|historical_event|"
                "literary_figure|philosophical_concept|indigenous_heritage",
        "period": "str|null",
        "description": "str",
        "relationship": "influence|homage|citation|context|subject_matter",
    }],
    
    # === LITERARY: Text Content ===
    "literary_content": [{
        "type": "poem|essay|quote|artist_statement|caption|prose",
        "full_text": "str",
        "author": "str|null",
        "language": "en|fr|bilingual",
        "series_name": "str|null — e.g. 'ABC Collection'",
    }],
    
    # === BUSINESS: Listings with Contact ===
    "businesses": [{
        "name": "str",
        "business_type": "hotel|restaurant|boutique|gallery|spa|"
                         "real_estate_agency|yacht_charter|aviation|"
                         "creative_agency|architecture_firm|interior_design|"
                         "car_rental|museum|artist_residency|photography_studio",
        "location": "str|null",
        "contact": {
            "phone": "str|null",
            "email": "str|null",
            "website": "str|null",
            "instagram": "str|null",
        },
        "years_operating": "str|null",
        "certifications": ["IATA", "Relais & Chateaux", etc.],
    }],
    
    # === EVENTS ===
    "events": [{
        "name": "str",
        "event_type": "regatta|art_exhibition|music_festival|food_festival|"
                      "film_festival|sporting|gala|holiday|carnival|market|"
                      "literary_festival|theatre_festival|awareness_event",
        "date": "str|null",
        "location": "str|null",
        "recurring": "bool",
        "organizer": "str|null",
    }],
    
    # === SERVICES ===
    "services": [{
        "name": "str",
        "service_type": "villa_rental|yacht_charter|private_aviation|"
                        "concierge|transportation|photography|design|"
                        "construction|architecture|interior_design|"
                        "spa_wellness|art_advisory|real_estate_sales",
    }],
    
    # === VEHICLES/CRAFT (maps to NUKE vehicles table) ===
    "vehicles": [{
        "type": "aircraft|yacht|sailboat|automobile|helicopter",
        "make": "str|null — Pilatus, Dassault, etc.",
        "model": "str|null — PC-12, Falcon, etc.",
        "operator": "str|null — Tradewind Aviation, etc.",
        "description": "str",
    }],
    
    # === IDENTIFIERS/CERTIFICATIONS (NEW) ===
    "identifiers": [{
        "type": "issn|iata|siret|anniversary|certification|award",
        "value": "str",
        "entity": "str — what it belongs to",
    }],
    
    # === DESIGN ANALYSIS ===
    "design_analysis": {
        "layout_type": "full_bleed_photo|text_columns|grid|asymmetric|"
                       "centered|mixed",
        "image_text_ratio": "float 0.0-1.0",
        "color_palette": ["hex or descriptive"],
        "language": "en|fr|bilingual_en_fr",
        "typography_notes": "str",
    },
    
    # === RAW TEXT ===
    "raw_text": "str — ALL text visible on page, verbatim",
    
    # === UNCATEGORIZED (schema expansion triggers) ===
    "uncategorized": [{
        "content": "str",
        "suggested_category": "str",
        "why_uncategorized": "str",
    }],
    
    # === META ===
    "confidence": "float 0-1 — overall confidence in extraction",
    "needs_human_review": "bool",
    "training_quality_score": "float 0-1",
}
