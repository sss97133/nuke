-- Dynamic make corrections and model metadata
-- Stores per-make correction factors that can be auto-derived by the retrain pipeline

CREATE TABLE IF NOT EXISTS prediction_model_make_corrections (
  id SERIAL PRIMARY KEY,
  model_version INTEGER NOT NULL,
  make TEXT NOT NULL,
  correction_factor NUMERIC(6,4) NOT NULL DEFAULT 1.0,
  sample_size INTEGER,
  bias_pct NUMERIC(6,1),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_version, make)
);

-- Index for fast lookups by model version
CREATE INDEX idx_make_corrections_version ON prediction_model_make_corrections(model_version);

-- Seed with current v13 hardcoded values so the system works immediately
INSERT INTO prediction_model_make_corrections (model_version, make, correction_factor, sample_size, bias_pct) VALUES
  (13, 'BENTLEY',       1.0800, 10, 8.0),
  (13, 'LAND ROVER',    1.0540, 32, 5.4),
  (13, 'PORSCHE',       1.0350, 86, 3.4),
  (13, 'LEXUS',         1.0350, 15, 3.4),
  (13, 'MERCEDES-BENZ', 1.0090, 96, 0.9),
  (13, 'FORD',          1.0050, 80, 0.5),
  (13, 'TOYOTA',        1.0040, 49, 0.4),
  (13, 'DODGE',         1.0030, 20, 0.3),
  (13, 'CHEVROLET',     1.0020, 84, 0.2),
  (13, 'BMW',           0.9940, 69, -0.6),
  (13, 'GMC',           0.9920, 15, -0.8),
  (13, 'PONTIAC',       0.9880, 11, -1.2),
  (13, 'ALFA ROMEO',    0.9750, 10, -2.5),
  (13, 'JAGUAR',        0.9710, 18, -2.9),
  (13, 'AUDI',          0.9630, 18, -3.7),
  (13, 'HONDA',         0.9420, 22, -5.8),
  (13, 'VOLKSWAGEN',    0.9290, 13, -7.1),
  (13, 'JEEP',          0.9090, 25, -9.1),
  (13, 'CADILLAC',      0.9050, 18, -9.5)
ON CONFLICT (model_version, make) DO NOTHING;

-- Era correction factors (v15 feature — derived from residual analysis)
-- Pre-1970 vehicles have 21.6% MAPE vs 13.6% for 2010s
CREATE TABLE IF NOT EXISTS prediction_model_era_corrections (
  id SERIAL PRIMARY KEY,
  model_version INTEGER NOT NULL,
  era_label TEXT NOT NULL, -- e.g. 'pre_1970', '1970s', '1980s', etc.
  year_min INTEGER NOT NULL,
  year_max INTEGER NOT NULL,
  correction_factor NUMERIC(6,4) NOT NULL DEFAULT 1.0,
  sample_size INTEGER,
  bias_pct NUMERIC(6,1),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_version, era_label)
);
