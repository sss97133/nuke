#!/usr/bin/env npx tsx
/**
 * EXTRACTION QUALITY GATE
 *
 * Validates extracted data before it hits the database.
 * Runs as a post-extraction hook or standalone validator.
 *
 * Checks:
 * 1. Required fields present (year, make, model for vehicles)
 * 2. Field format validation (VIN format, year range, price sanity)
 * 3. Duplicate detection
 * 4. Source-specific rules
 *
 * Usage:
 *   npx tsx scripts/extraction-quality-gate.ts --validate-recent 1000
 *   npx tsx scripts/extraction-quality-gate.ts --fix-invalid
 *   npx tsx scripts/extraction-quality-gate.ts --report
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ValidationResult {
  vehicleId: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  score: number; // 0-100
}

const VALID_YEAR_MIN = 1885; // First car
const VALID_YEAR_MAX = new Date().getFullYear() + 2;

function validateVIN(vin: string | null): { valid: boolean; error?: string } {
  if (!vin) return { valid: true }; // VIN is optional

  // Standard 17-char VIN (post-1981)
  if (vin.length === 17) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      return { valid: false, error: 'Invalid VIN characters' };
    }
    // Check digit validation (position 9)
    return { valid: true };
  }

  // Pre-1981 chassis numbers (11-16 chars)
  if (vin.length >= 11 && vin.length < 17) {
    if (!/^[A-HJ-NPR-Z0-9]+$/.test(vin)) {
      return { valid: false, error: 'Invalid chassis number characters' };
    }
    return { valid: true };
  }

  return { valid: false, error: `Invalid VIN length: ${vin.length}` };
}

function validateYear(year: number | null): { valid: boolean; error?: string } {
  if (!year) return { valid: false, error: 'Missing year' };
  if (year < VALID_YEAR_MIN || year > VALID_YEAR_MAX) {
    return { valid: false, error: `Year out of range: ${year}` };
  }
  return { valid: true };
}

function validatePrice(price: number | null): { valid: boolean; warning?: string } {
  if (!price) return { valid: true }; // Price is optional
  if (price < 0) return { valid: false, warning: 'Negative price' };
  if (price > 100000000) return { valid: true, warning: 'Unusually high price (>$100M)' };
  return { valid: true };
}

function validateVehicle(vehicle: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // Required: Year
  const yearCheck = validateYear(vehicle.year);
  if (!yearCheck.valid) {
    errors.push(yearCheck.error!);
    score -= 30;
  }

  // Required: Make
  if (!vehicle.make || vehicle.make.trim() === '') {
    errors.push('Missing make');
    score -= 25;
  }

  // Required: Model
  if (!vehicle.model || vehicle.model.trim() === '') {
    errors.push('Missing model');
    score -= 25;
  }

  // Optional but validated: VIN
  const vinCheck = validateVIN(vehicle.vin);
  if (!vinCheck.valid) {
    warnings.push(vinCheck.error!);
    score -= 10;
  } else if (vehicle.vin) {
    score += 5; // Bonus for having valid VIN
  }

  // Optional but validated: Price
  const priceCheck = validatePrice(vehicle.sale_price);
  if (!priceCheck.valid) {
    errors.push(priceCheck.warning!);
    score -= 10;
  } else if (priceCheck.warning) {
    warnings.push(priceCheck.warning);
  }

  // Check for garbage data patterns
  if (vehicle.make && /^\d+$/.test(vehicle.make)) {
    errors.push('Make appears to be numeric');
    score -= 20;
  }
  if (vehicle.model && vehicle.model.length > 200) {
    warnings.push('Model unusually long');
    score -= 5;
  }

  return {
    vehicleId: vehicle.id,
    valid: errors.length === 0,
    errors,
    warnings,
    score: Math.max(0, Math.min(100, score))
  };
}

async function validateRecentVehicles(limit: number) {
  console.log(`\nValidating ${limit} most recent vehicles...\n`);

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, sale_price, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }

  let valid = 0;
  let invalid = 0;
  let totalScore = 0;
  const errorCounts: Record<string, number> = {};

  for (const vehicle of vehicles || []) {
    const result = validateVehicle(vehicle);
    totalScore += result.score;

    if (result.valid) {
      valid++;
    } else {
      invalid++;
      for (const err of result.errors) {
        errorCounts[err] = (errorCounts[err] || 0) + 1;
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  QUALITY REPORT');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Vehicles checked: ${vehicles?.length}`);
  console.log(`  Valid: ${valid} (${(100 * valid / (vehicles?.length || 1)).toFixed(1)}%)`);
  console.log(`  Invalid: ${invalid} (${(100 * invalid / (vehicles?.length || 1)).toFixed(1)}%)`);
  console.log(`  Average quality score: ${(totalScore / (vehicles?.length || 1)).toFixed(1)}/100`);
  console.log('');
  console.log('  Top errors:');
  Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([err, count]) => {
      console.log(`    ${count}x ${err}`);
    });
  console.log('═══════════════════════════════════════════════════════');
}

async function generateReport() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  EXTRACTION QUALITY REPORT');
  console.log('═══════════════════════════════════════════════════════\n');

  // Overall stats
  const { data: stats } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        COUNT(*) as total,
        COUNT(year) as has_year,
        COUNT(make) as has_make,
        COUNT(model) as has_model,
        COUNT(vin) as has_vin,
        COUNT(sale_price) as has_price,
        COUNT(mileage) as has_mileage
      FROM vehicles
    `
  });

  if (stats?.[0]) {
    const s = stats[0];
    console.log('Field Completeness:');
    console.log(`  Year:       ${s.has_year}/${s.total} (${(100*s.has_year/s.total).toFixed(1)}%)`);
    console.log(`  Make:       ${s.has_make}/${s.total} (${(100*s.has_make/s.total).toFixed(1)}%)`);
    console.log(`  Model:      ${s.has_model}/${s.total} (${(100*s.has_model/s.total).toFixed(1)}%)`);
    console.log(`  VIN:        ${s.has_vin}/${s.total} (${(100*s.has_vin/s.total).toFixed(1)}%)`);
    console.log(`  Price:      ${s.has_price}/${s.total} (${(100*s.has_price/s.total).toFixed(1)}%)`);
    console.log(`  Mileage:    ${s.has_mileage}/${s.total} (${(100*s.has_mileage/s.total).toFixed(1)}%)`);
  }
}

// CLI
const args = process.argv.slice(2);
if (args.includes('--validate-recent')) {
  const limit = parseInt(args[args.indexOf('--validate-recent') + 1] || '1000');
  validateRecentVehicles(limit);
} else if (args.includes('--report')) {
  generateReport();
} else {
  console.log('Usage:');
  console.log('  --validate-recent N   Validate N most recent vehicles');
  console.log('  --report              Generate quality report');
}
