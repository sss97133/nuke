/**
 * build-extraction-context.mjs
 *
 * Queries the reference library (RPO codes, paint codes, known issues, trim specs)
 * and builds contextual reference data to inject into extraction prompts.
 *
 * Transforms extraction from "extract blindly" to "extract with forensic context."
 *
 * Usage:
 *   import { buildExtractionContext, formatContextForPrompt } from './lib/build-extraction-context.mjs';
 *   const ctx = await buildExtractionContext(db, 1970, 'Chevrolet', 'Chevelle');
 *   const promptSection = formatContextForPrompt(ctx);
 */

/**
 * Query all available reference data for a vehicle's year/make/model.
 * Returns structured context for prompt injection.
 */
export async function buildExtractionContext(db, year, make, model) {
  if (!year || !make) return {};
  const context = {};

  try {
    // 1. Option codes from comment_library_extractions (mined from auction comments)
    const codes = await db.query(`
      SELECT extracted_data FROM comment_library_extractions
      WHERE make ILIKE $1 AND extraction_type = 'option_code'
        AND (year_start IS NULL OR year_start <= $2)
        AND (year_end IS NULL OR year_end >= $2)
      ORDER BY confidence DESC NULLS LAST
      LIMIT 40`, [make, year]);
    if (codes.rows.length > 0) {
      context.option_codes = codes.rows.map(r => r.extracted_data);
    }

    // 2. Engine specs from library
    const engines = await db.query(`
      SELECT extracted_data FROM comment_library_extractions
      WHERE make ILIKE $1 AND extraction_type = 'engine_spec'
        AND (year_start IS NULL OR year_start <= $2)
        AND (year_end IS NULL OR year_end >= $2)
      ORDER BY confidence DESC NULLS LAST
      LIMIT 20`, [make, year]);
    if (engines.rows.length > 0) {
      context.known_engines = engines.rows.map(r => r.extracted_data);
    }

    // 3. Transmission specs from library
    const trans = await db.query(`
      SELECT extracted_data FROM comment_library_extractions
      WHERE make ILIKE $1 AND extraction_type = 'transmission_spec'
        AND (year_start IS NULL OR year_start <= $2)
        AND (year_end IS NULL OR year_end >= $2)
      ORDER BY confidence DESC NULLS LAST
      LIMIT 15`, [make, year]);
    if (trans.rows.length > 0) {
      context.known_transmissions = trans.rows.map(r => r.extracted_data);
    }

    // 4. Paint codes
    const paints = await db.query(`
      SELECT code, name, color_family FROM paint_codes
      WHERE make ILIKE $1
        AND (year_start IS NULL OR year_start <= $2)
        AND (year_end IS NULL OR year_end >= $2)
      ORDER BY name
      LIMIT 30`, [make, year]);
    if (paints.rows.length > 0) {
      context.paint_codes = paints.rows;
    }

    // 5. Known issues
    const issues = await db.query(`
      SELECT extracted_data FROM comment_library_extractions
      WHERE make ILIKE $1 AND extraction_type = 'known_issue'
        AND (year_start IS NULL OR year_start <= $2)
        AND (year_end IS NULL OR year_end >= $2)
      ORDER BY confidence DESC NULLS LAST
      LIMIT 15`, [make, year]);
    if (issues.rows.length > 0) {
      context.known_issues = issues.rows.map(r => r.extracted_data);
    }

    // 6. Trim packages from OEM reference
    const trims = await db.query(`
      SELECT trim_name, trim_code, standard_features FROM oem_trim_levels
      WHERE make ILIKE $1
        AND (year_start IS NULL OR year_start <= $2)
        AND (year_end IS NULL OR year_end >= $2)
      ORDER BY trim_name
      LIMIT 10`, [make, year]);
    if (trims.rows.length > 0) {
      context.trim_packages = trims.rows;
    }

    // 7. Production facts
    const facts = await db.query(`
      SELECT extracted_data FROM comment_library_extractions
      WHERE make ILIKE $1 AND extraction_type = 'production_fact'
        AND (year_start IS NULL OR year_start <= $2)
        AND (year_end IS NULL OR year_end >= $2)
      ORDER BY confidence DESC NULLS LAST
      LIMIT 10`, [make, year]);
    if (facts.rows.length > 0) {
      context.production_facts = facts.rows.map(r => r.extracted_data);
    }

  } catch (err) {
    // Non-fatal — extraction works without context, just less forensically
    console.error(`[CONTEXT] Error building context for ${year} ${make}: ${err.message}`);
  }

  return context;
}

/**
 * Format context object into a prompt section string.
 * Only includes sections where data exists.
 */
export function formatContextForPrompt(context) {
  if (!context || Object.keys(context).length === 0) return '';

  const sections = [];

  if (context.option_codes?.length) {
    const codeList = context.option_codes
      .map(c => `  ${c.code || c.c}: ${c.description || c.d || ''} (${c.category || c.cat || ''})`)
      .join('\n');
    sections.push(`REFERENCE — Known option codes for this make/year:\n${codeList}\nCross-reference any codes in the description against these. Flag unrecognized codes.`);
  }

  if (context.known_engines?.length) {
    const engineList = context.known_engines
      .map(e => `  ${e.name || e.type || ''}: ${e.displacement_ci || ''}ci / ${e.displacement_liters || ''}L, ${e.horsepower || '?'}hp`)
      .join('\n');
    sections.push(`REFERENCE — Known engines for this make/year:\n${engineList}\nIdentify which engine this vehicle has based on the description.`);
  }

  if (context.known_transmissions?.length) {
    const transList = context.known_transmissions
      .map(t => `  ${t.name || t.type || ''}: ${t.gears || t.speeds || '?'}-speed ${t.type || ''}`)
      .join('\n');
    sections.push(`REFERENCE — Known transmissions:\n${transList}`);
  }

  if (context.paint_codes?.length) {
    const paintList = context.paint_codes
      .map(p => `  ${p.code}: ${p.name} (${p.color_family})`)
      .join('\n');
    sections.push(`REFERENCE — Known paint codes for this make/year:\n${paintList}\nIf a color is mentioned, identify the likely paint code.`);
  }

  if (context.known_issues?.length) {
    const issueList = context.known_issues
      .map(i => `  - ${i.issue || i.description || JSON.stringify(i).slice(0, 100)}`)
      .join('\n');
    sections.push(`REFERENCE — Known issues for this make/model:\n${issueList}\nCheck if the description mentions or addresses any of these.`);
  }

  if (context.trim_packages?.length) {
    const trimList = context.trim_packages
      .map(t => `  ${t.trim_name}${t.trim_code ? ` (${t.trim_code})` : ''}: ${(t.standard_features || []).join(', ')}`)
      .join('\n');
    sections.push(`REFERENCE — Known trim packages:\n${trimList}\nIdentify which trim level this vehicle is.`);
  }

  if (context.production_facts?.length) {
    const factList = context.production_facts
      .map(f => `  - ${f.fact || f.description || JSON.stringify(f).slice(0, 100)}`)
      .join('\n');
    sections.push(`REFERENCE — Production facts:\n${factList}`);
  }

  return sections.join('\n\n');
}
