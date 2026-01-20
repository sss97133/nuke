#!/usr/bin/env node

/**
 * Ingest OTTO MARKT listing and establish OTTO + Delmo relationships.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const LISTING_URL = 'https://www.otto-markt.com/1959-delmo-chevrolet-apache';
const LISTING_SLUG = '1959-delmo-chevrolet-apache';
const ORG_WEBSITE = 'https://www.otto-markt.com';
const ORG_NAME = 'OTTO MARKT';
const ORG_DESC =
  'OTTO MARKT is committed to sourcing, selling and servicing the finest collector grade and exotic automobiles from around the world.';
const ORG_ADDRESS = '14950 N 83rd Pl';
const ORG_CITY = 'Scottsdale';
const ORG_STATE = 'AZ';
const ORG_ZIP = '85260';
const ORG_PHONE = '480.625.4654';
const ORG_EMAIL = 'sales@ottocarclub.com';

const DELMO_NAME = 'Delmo Speed';
const DELMO_WEBSITE = 'https://www.instagram.com/delmospeed/';

const EVIDENCE_URLS = [
  'https://www.instagram.com/otto.markt',
  'https://www.instagram.com/p/DUsF26qgcDf/?img_index=1',
  'https://www.instagram.com/delmospeed/',
  'https://www.instagram.com/p/DUsF26qgcDf/?img_index=1',
  'https://www.instagram.com/p/DQdBjoHkcZo/?img_index=1',
  'https://www.instagram.com/p/DQIcG0RkWIw/',
  'https://www.instagram.com/p/DPKbVtsEq7M/',
  'http://instagram.com/p/DPAdR0rCUdq/',
  'https://www.instagram.com/p/DOEWxpHjxa7/',
  'https://www.instagram.com/p/DNqesqFx-jm/',
  'https://www.instagram.com/p/DL8gdE0SULX/',
  'https://www.instagram.com/p/DLlRQD3y-SD/',
  'https://www.instagram.com/p/DHLpc-LxTS8/',
  'https://www.instagram.com/p/DFS1-cjPgb7/',
  'https://www.instagram.com/p/DFBo1oGyTgG/?img_index=1',
  'https://www.instagram.com/p/DE-iHY3yI0S/',
  'https://www.instagram.com/p/DBwVQl4voLs/',
  'https://www.instagram.com/p/DAjZ-ImSpmX/',
  'https://www.instagram.com/p/C_1g4uHSYti/?img_index=1',
  'https://www.instagram.com/p/C_dXHyev9B2/',
  'https://www.instagram.com/p/C-aatUApc-I/',
  'https://www.instagram.com/p/C6g2RyWu0Cb/',
  'https://www.instagram.com/p/C6MdQmAOt4_/',
  'https://www.instagram.com/p/C4DqpPpxL5E/',
  'https://www.instagram.com/p/C375fQZrPFg/',
  'https://www.instagram.com/p/C2iOZNhvTbK/',
  'https://www.instagram.com/p/CzcWQIBPUX2/',
  'https://www.instagram.com/p/Cyw491MRSBh/',
  'https://www.instagram.com/p/CyooGHjuppU/',
  'https://www.instagram.com/p/Cvtgv6iOrJH/',
  'https://www.instagram.com/p/CvH8qgSO___/',
  'https://www.instagram.com/p/CszSZd9yXD3/',
  'https://www.instagram.com/p/CshwRCaxcFj/?img_index=1',
  'https://www.instagram.com/p/CsaAesGJUBA/',
  'https://www.instagram.com/p/CsXtomGOBzL/',
  'https://www.instagram.com/p/Cq_t-XhO3vG/',
  'https://www.instagram.com/p/CpyhPh-OSVo/',
  'https://www.instagram.com/p/Ck_JhdBOk01/?img_index=1',
  'https://www.instagram.com/p/CjRYnt0OzVG/?img_index=1',
  'https://www.instagram.com/p/ChgNk5guqRg/',
  'https://www.instagram.com/p/Ccojpi9phdm/',
  'https://www.instagram.com/p/CcYIY12uTPu/',
  'https://www.instagram.com/p/CatDrtCuqrf/',
  'https://www.instagram.com/p/CWUygcvrZC-/',
  'https://www.instagram.com/p/CUL4UcHjOpG/',
  'https://www.instagram.com/p/CO_kO8tDDCS/',
  'https://www.instagram.com/p/CKgvM12jTsp/',
  'https://www.instagram.com/p/CJT9BlkjjaZ/',
];

function parseListingHtml(html) {
  const titleMatch =
    html.match(/<h2[^>]*>\s*<strong>\s*(\d{4}[^<]+)\s*<\/strong>\s*<\/h2>/i) ||
    html.match(/<h2[^>]*>\s*(\d{4}[^<]+)\s*<\/h2>/i);
  const title = titleMatch?.[1]?.trim() || '1959 Delmo Chevrolet Apache';

  const field = (label) => {
    const re = new RegExp(`${label}\\s*<\\/[^>]+>\\s*([^<\\n]+)`, 'i');
    const m = html.match(re);
    return m?.[1]?.trim() || null;
  };

  const summaryMatch = html.match(/<h2[^>]*>\s*SUMMARY\s*<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  const summary = summaryMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || null;

  const highlightsSection = html.match(/<h2[^>]*>\s*HIGHLIGHTS\s*<\/h2>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
  const highlights = highlightsSection?.[1]
    ?.split(/<li[^>]*>/i)
    ?.map((s) => s.replace(/<[^>]+>/g, '').trim())
    ?.filter(Boolean) || [];

  return {
    title,
    exteriorColor: field('Exterior Color') || null,
    interiorColor: field('Interior Color') || null,
    mileage: field('Mileage') || null,
    transmission: field('Transmission') || null,
    location: field('Location') || null,
    stockNo: field('Stock No') || null,
    summary,
    highlights,
  };
}

function parseVehicleBasics(title) {
  const parts = title.split(' ').filter(Boolean);
  const year = parseInt(parts[0], 10);
  const make = parts.includes('Chevrolet') ? 'Chevrolet' : (parts[2] || 'Chevrolet');
  const makeIdx = parts.indexOf(make);
  const model = makeIdx >= 0 ? parts.slice(makeIdx + 1).join(' ').trim() : 'Apache';
  return { year: Number.isFinite(year) ? year : 1959, make, model };
}

async function findOrCreateOrg({ name, website }) {
  const { data: existing } = await supabase
    .from('businesses')
    .select('id, business_name, website, metadata')
    .or(`website.eq.${website},website.eq.${website.replace(/\/$/, '')}`)
    .maybeSingle();

  if (existing?.id) return existing;

  const { data: byName } = await supabase
    .from('businesses')
    .select('id, business_name, website, metadata')
    .ilike('business_name', `%${name}%`)
    .maybeSingle();

  if (byName?.id) return byName;

  const { data: created, error } = await supabase
    .from('businesses')
    .insert({
      business_name: name,
      website,
      business_type: 'dealership',
      is_public: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id, business_name, website, metadata')
    .single();

  if (error) throw error;
  return created;
}

async function upsertVehicle(record) {
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id, discovery_url, platform_url')
    .or(`discovery_url.ilike.%${LISTING_SLUG}%,platform_url.ilike.%${LISTING_SLUG}%`)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('vehicles')
      .update({
        ...record,
        discovery_url: LISTING_URL,
        platform_url: LISTING_URL,
      })
      .eq('id', existing.id);
    return existing.id;
  }

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      ...record,
      discovery_url: LISTING_URL,
      platform_url: LISTING_URL,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

async function linkOrgVehicle(orgId, vehicleId, relationshipType, notes, status = 'active') {
  await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      relationship_type: relationshipType,
      status,
      notes,
      auto_tagged: false,
    }, { onConflict: 'organization_id,vehicle_id,relationship_type' });
}

async function upsertVehicleMetadata(vehicleId, patch) {
  const { data } = await supabase
    .from('vehicles')
    .select('import_metadata, relationship_notes')
    .eq('id', vehicleId)
    .maybeSingle();

  const merged = { ...(data?.import_metadata || {}), ...(patch || {}) };
  const relationshipNotes = patch?.relationship_notes
    ? (data?.relationship_notes ? `${data.relationship_notes} | ${patch.relationship_notes}` : patch.relationship_notes)
    : data?.relationship_notes || null;

  await supabase
    .from('vehicles')
    .update({
      import_metadata: merged,
      relationship_notes: relationshipNotes,
    })
    .eq('id', vehicleId);
}

async function main() {
  // Cleanup known junk vehicles from prior bad parses
  const { data: junkVehicles } = await supabase
    .from('vehicles')
    .select('id, discovery_url')
    .eq('make', 'OTTO')
    .eq('model', 'Car Club')
    .ilike('discovery_url', '%otto-markt.com/inventory%');

  if (junkVehicles && junkVehicles.length > 0) {
    await supabase
      .from('vehicles')
      .update({
        is_public: false,
        notes: 'invalid import (otto-markt menu scrape)',
      })
      .in('id', junkVehicles.map((v) => v.id));
  }

  const ottoOrg = await findOrCreateOrg({ name: ORG_NAME, website: ORG_WEBSITE });
  const delmoOrg = await findOrCreateOrg({ name: DELMO_NAME, website: DELMO_WEBSITE });

  // Update OTTO org basics
  await supabase
    .from('businesses')
    .update({
      website: ORG_WEBSITE,
      description: ORG_DESC,
      address: ORG_ADDRESS,
      city: ORG_CITY,
      state: ORG_STATE,
      zip_code: ORG_ZIP,
      phone: ORG_PHONE,
      email: ORG_EMAIL,
      metadata: {
        ...(ottoOrg.metadata || {}),
        sales_division: 'OTTO MARKT',
        inventory_url: ORG_WEBSITE,
      },
    })
    .eq('id', ottoOrg.id);

  // Fetch listing
  const res = await fetch(LISTING_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!res.ok) throw new Error(`Failed to fetch listing: ${res.status}`);
  const html = await res.text();
  const parsed = parseListingHtml(html);
  const basics = parseVehicleBasics(parsed.title);

  const descriptionParts = [];
  if (parsed.summary) descriptionParts.push(parsed.summary);
  if (parsed.highlights.length) {
    descriptionParts.push(`Highlights:\\n- ${parsed.highlights.join('\\n- ')}`);
  }

  const notesParts = [
    `Exterior: ${parsed.exteriorColor || 'unknown'}`,
    `Interior: ${parsed.interiorColor || 'unknown'}`,
    `Mileage: ${parsed.mileage || 'unknown'}`,
    `Transmission: ${parsed.transmission || 'unknown'}`,
    `Location: ${parsed.location || 'unknown'}`,
    `Stock No: ${parsed.stockNo || 'unknown'}`,
  ];

  const vehicleId = await upsertVehicle({
    year: basics.year,
    make: basics.make,
    model: basics.model,
    discovery_source: 'otto_markt',
    discovery_url: LISTING_URL,
    platform_source: 'otto_markt',
    platform_url: LISTING_URL,
    notes: notesParts.join(' | '),
    modification_details: descriptionParts.join('\\n\\n'),
    is_public: true,
  });

  // Relationships
  await linkOrgVehicle(ottoOrg.id, vehicleId, 'sold_by', 'Listed by OTTO MARKT', 'active');
  await linkOrgVehicle(delmoOrg.id, vehicleId, 'service_provider', 'Built by Delmo Speed', 'past');

  await upsertVehicleMetadata(vehicleId, {
    listing_url: LISTING_URL,
    evidence_urls: EVIDENCE_URLS,
    builder: 'Delmo Speed',
    seller: 'OTTO MARKT',
    relationship_notes: 'Delmo Speed built the vehicle; OTTO MARKT handled the latest listing/sale.',
  });

  console.log('✅ OTTO MARKT listing ingested and linked.');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
