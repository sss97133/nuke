-- Professional Appraisal Tables
-- Based on industry-standard vehicle condition assessment criteria
-- Hagerty 1-6 scale, PPI checklists, professional appraisal standards

-- Main condition assessment (Hagerty-style)
CREATE TABLE IF NOT EXISTS vehicle_condition_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  assessment_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- Overall Condition (Industry standard 1-6 scale)
  -- 1=Concours, 2=Excellent, 3=Good, 4=Fair, 5=Rough, 6=Parts
  overall_condition_rating INTEGER CHECK (overall_condition_rating BETWEEN 1 AND 6),
  
  -- Category Ratings (1-10 scale)
  exterior_rating INTEGER CHECK (exterior_rating BETWEEN 1 AND 10),
  interior_rating INTEGER CHECK (interior_rating BETWEEN 1 AND 10),
  mechanical_rating INTEGER CHECK (mechanical_rating BETWEEN 1 AND 10),
  undercarriage_rating INTEGER CHECK (undercarriage_rating BETWEEN 1 AND 10),
  
  -- Market indicators
  condition_value_multiplier NUMERIC, -- 0.5 to 2.0
  ready_for_show BOOLEAN,
  ready_for_daily_use BOOLEAN,
  
  -- Images used
  images_assessed UUID[],
  assessment_completeness INTEGER, -- 0-100 percent
  
  -- Verification
  assessed_by_model TEXT,
  human_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cond_assess_vehicle ON vehicle_condition_assessments(vehicle_id);
CREATE INDEX idx_cond_assess_rating ON vehicle_condition_assessments(overall_condition_rating);

-- Component-level condition tracking
CREATE TABLE IF NOT EXISTS component_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id),
  
  -- Component ID
  component_name TEXT NOT NULL,
  component_type TEXT, -- 'body_panel', 'mechanical', 'interior', 'trim', 'glass'
  location TEXT,
  
  -- Condition (1-10 scale)
  condition_rating INTEGER CHECK (condition_rating BETWEEN 1 AND 10),
  
  -- Issues
  damage_types TEXT[], -- ['rust', 'dent', 'crack', 'missing']
  wear_level TEXT, -- 'none', 'light', 'moderate', 'heavy'
  
  -- Originality
  is_original BOOLEAN,
  is_oem_replacement BOOLEAN,
  is_aftermarket BOOLEAN,
  
  -- Repair needs
  needs_attention BOOLEAN,
  repair_priority TEXT, -- 'immediate', 'soon', 'monitor', 'cosmetic'
  estimated_cost NUMERIC,
  
  -- Detection
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  detected_by_model TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comp_cond_vehicle ON component_conditions(vehicle_id);
CREATE INDEX idx_comp_cond_type ON component_conditions(component_type);
CREATE INDEX idx_comp_cond_needs ON component_conditions(needs_attention) WHERE needs_attention = true;

-- Paint quality assessment (Professional standards)
CREATE TABLE IF NOT EXISTS paint_quality_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id),
  panel_name TEXT,
  
  -- Paint assessment
  appears_original BOOLEAN,
  repaint_quality TEXT, -- 'show_quality', 'professional', 'good', 'average', 'poor'
  finish_type TEXT, -- 'single_stage', 'base_clear', 'enamel', 'lacquer'
  
  -- Quality metrics
  orange_peel_level TEXT, -- 'none', 'slight', 'moderate', 'heavy'
  color_match TEXT, -- 'perfect', 'good', 'fair', 'poor'
  gloss_condition TEXT,
  
  -- Defects
  defects TEXT[], -- ['scratch', 'chip', 'fade', 'overspray', 'run', 'sag']
  defect_severity TEXT, -- 'minor', 'moderate', 'major'
  
  -- Professional rating (1-10)
  paint_quality_score INTEGER CHECK (paint_quality_score BETWEEN 1 AND 10),
  
  -- Requirements met
  image_quality_sufficient BOOLEAN,
  
  assessed_by_model TEXT,
  confidence INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_paint_vehicle ON paint_quality_assessments(vehicle_id);

-- Appraisal standards reference (digitized from books/guides)
CREATE TABLE IF NOT EXISTS appraisal_grading_standards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Standard identification
  standard_name TEXT NOT NULL, -- 'Hagerty Scale', 'PPI Checklist', 'Classic Car Club'
  standard_version TEXT,
  category TEXT, -- 'exterior', 'interior', 'mechanical', 'overall'
  
  -- Grade/Rating level
  rating_level INTEGER, -- 1-6 for Hagerty, 1-10 for others
  rating_label TEXT, -- 'Excellent', 'Good', 'Fair', etc.
  
  -- Criteria (from actual standards)
  criteria_description TEXT,
  specific_requirements TEXT[],
  disqualifying_factors TEXT[],
  
  -- Examples
  example_conditions TEXT[],
  reference_images TEXT[],
  
  -- Source documentation
  source_document TEXT,
  source_url TEXT,
  page_reference TEXT,
  
  -- Usage
  applies_to_vehicle_types TEXT[], -- ['classic', 'muscle', 'exotic', 'daily']
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_grading_standards_name ON appraisal_grading_standards(standard_name);
CREATE INDEX idx_grading_standards_category ON appraisal_grading_standards(category);

COMMENT ON TABLE vehicle_condition_assessments IS 'Overall vehicle condition using industry-standard 1-6 Hagerty scale';
COMMENT ON TABLE component_conditions IS 'Detailed component-by-component condition tracking';
COMMENT ON TABLE paint_quality_assessments IS 'Professional paint quality assessment per panel';
COMMENT ON TABLE appraisal_grading_standards IS 'Digitized professional appraisal standards from industry guides';

