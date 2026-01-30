#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Expanded forum list - organized by category
const FORUMS = [
  // === CLASSIC/MUSCLE CARS ===
  { slug: 'jalopyjournal', name: 'The H.A.M.B.', base_url: 'https://www.jalopyjournal.com/forum/', platform_type: 'vbulletin', vehicle_categories: ['hot-rod', 'pre-war', 'custom'] },
  { slug: 'hotrodders', name: 'Hot Rodders Forum', base_url: 'https://www.hotrodders.com/forum/', platform_type: 'vbulletin', vehicle_categories: ['hot-rod', 'classic'] },
  { slug: 'aaca', name: 'AACA Forums', base_url: 'https://forums.aaca.org/', platform_type: 'invision', vehicle_categories: ['antique', 'classic'] },
  { slug: 'corvetteforum', name: 'Corvette Forum', base_url: 'https://www.corvetteforum.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['corvette'] },
  { slug: 'midenginecorvetteforum', name: 'Mid Engine Corvette Forum', base_url: 'https://www.midenginecorvetteforum.com/forum/', platform_type: 'xenforo', vehicle_categories: ['corvette', 'c8'] },
  { slug: 'smokinvette', name: 'SmokinVette', base_url: 'https://www.smokinvette.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['corvette'] },
  { slug: 'corral', name: 'Corral.net', base_url: 'https://www.corral.net/forums/', platform_type: 'vbulletin', vehicle_categories: ['mustang', 'ford'] },

  // === IMPORT / JDM ===
  { slug: 'jdmstyletuning', name: 'JDM Style Tuning', base_url: 'https://forum.jdmstyletuning.com/', platform_type: 'vbulletin', vehicle_categories: ['jdm', 'import'] },
  { slug: 'civicx', name: 'CivicX', base_url: 'https://www.civicx.com/forum/', platform_type: 'xenforo', vehicle_categories: ['honda', 'civic'] },
  { slug: 'clubcivic', name: 'Club Civic', base_url: 'https://www.clubcivic.com/forum/', platform_type: 'vbulletin', vehicle_categories: ['honda', 'civic'] },
  { slug: 'clublexus', name: 'ClubLexus', base_url: 'https://www.clublexus.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['lexus', 'toyota'] },
  { slug: 'mightycarmods', name: 'Mighty Car Mods', base_url: 'https://forums.mightycarmods.com/', platform_type: 'discourse', vehicle_categories: ['import', 'tuner'] },
  { slug: 'driftworks', name: 'Driftworks Forum', base_url: 'https://www.driftworks.com/forum/', platform_type: 'xenforo', vehicle_categories: ['drift', 'jdm'] },
  { slug: 'supraforums', name: 'SupraForums', base_url: 'https://www.supraforums.com/', platform_type: 'vbulletin', vehicle_categories: ['toyota', 'supra'] },
  { slug: 'mr2oc', name: 'MR2 Owners Club', base_url: 'https://www.mr2oc.com/', platform_type: 'phpbb', vehicle_categories: ['toyota', 'mr2'] },
  { slug: 'dseries', name: 'D-Series Forum', base_url: 'https://www.d-series.org/', platform_type: 'vbulletin', vehicle_categories: ['honda'] },
  { slug: 'dsmtuners', name: 'DSMtuners', base_url: 'https://www.dsmtuners.com/', platform_type: 'xenforo', vehicle_categories: ['mitsubishi', 'eagle', 'dsm'] },
  { slug: 'dsmtalk', name: 'DSMTalk', base_url: 'https://www.dsmtalk.com/', platform_type: 'vbulletin', vehicle_categories: ['mitsubishi', 'eagle', 'dsm'] },
  { slug: 'infinitiforum', name: 'Infiniti Forum', base_url: 'https://infinitiforum.net/', platform_type: 'xenforo', vehicle_categories: ['infiniti', 'nissan'] },

  // === TRUCKS & OFF-ROAD ===
  { slug: 'pirate4x4', name: 'Pirate 4x4', base_url: 'https://www.pirate4x4.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['offroad', '4x4'] },
  { slug: 'offroadtb', name: 'OffRoadTB', base_url: 'https://forums.offroadtb.com/', platform_type: 'xenforo', vehicle_categories: ['offroad', 'trailblazer'] },
  { slug: 'offroadpassport', name: 'Offroad Passport', base_url: 'https://offroadpassport.com/forums/', platform_type: 'xenforo', vehicle_categories: ['offroad', 'overland'] },
  { slug: 'overlandbound', name: 'Overland Bound', base_url: 'https://www.overlandbound.com/forums/', platform_type: 'xenforo', vehicle_categories: ['overland', 'offroad'] },
  { slug: 'gmt400', name: 'GMT400 Forum', base_url: 'https://www.gmt400.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['gm-truck', 'chevy'] },
  { slug: 'tacomaworld', name: 'Tacoma World', base_url: 'https://www.tacomaworld.com/', platform_type: 'xenforo', vehicle_categories: ['toyota', 'tacoma'] },
  { slug: 'tacoma4g', name: 'Tacoma 4G', base_url: 'https://www.tacoma4g.com/forum/', platform_type: 'xenforo', vehicle_categories: ['toyota', 'tacoma'] },
  { slug: '4runners', name: '4Runner Forum', base_url: 'https://www.4runners.com/', platform_type: 'xenforo', vehicle_categories: ['toyota', '4runner'] },
  { slug: '4runner-forums', name: '4Runner Forums', base_url: 'https://www.4runner-forums.com/forums/', platform_type: 'xenforo', vehicle_categories: ['toyota', '4runner'] },
  { slug: 'toyotanation', name: 'Toyota Nation', base_url: 'https://www.toyotanation.com/', platform_type: 'xenforo', vehicle_categories: ['toyota'] },
  { slug: 'ttora', name: 'TTORA', base_url: 'https://www.ttora.com/', platform_type: 'vbulletin', vehicle_categories: ['toyota', 'offroad'] },
  { slug: '5thgenrams', name: '5th Gen RAMs', base_url: 'https://5thgenrams.com/', platform_type: 'xenforo', vehicle_categories: ['ram', 'dodge'] },
  { slug: 'jlwranglerforums', name: 'JL Wrangler Forums', base_url: 'https://www.jlwranglerforums.com/', platform_type: 'xenforo', vehicle_categories: ['jeep', 'wrangler'] },
  { slug: 'wranglertjforum', name: 'Wrangler TJ Forum', base_url: 'https://wranglertjforum.com/', platform_type: 'xenforo', vehicle_categories: ['jeep', 'wrangler'] },
  { slug: 'jeepgladiatorforum', name: 'Jeep Gladiator Forum', base_url: 'https://www.jeepgladiatorforum.com/forum/', platform_type: 'xenforo', vehicle_categories: ['jeep', 'gladiator'] },
  { slug: 'f150forum', name: 'F150 Forum', base_url: 'https://www.f150forum.com/', platform_type: 'xenforo', vehicle_categories: ['ford', 'f150'] },
  { slug: 'f150online', name: 'F150 Online', base_url: 'https://www.f150online.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['ford', 'f150'] },
  { slug: 'fordf150net', name: 'Ford F150 Net', base_url: 'https://www.fordf150.net/forums/', platform_type: 'vbulletin', vehicle_categories: ['ford', 'f150'] },
  { slug: 'f150-forums', name: 'F150 Forums', base_url: 'https://www.f150-forums.com/', platform_type: 'xenforo', vehicle_categories: ['ford', 'f150'] },
  { slug: 'ford-trucks', name: 'Ford Truck Enthusiasts', base_url: 'https://www.ford-trucks.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['ford', 'truck'] },
  { slug: 'gm-trucks', name: 'GM Trucks', base_url: 'https://www.gm-trucks.com/forums/', platform_type: 'xenforo', vehicle_categories: ['gm', 'chevy', 'gmc'] },

  // === EUROPEAN SPORTS/LUXURY ===
  { slug: 'germancarforum', name: 'German Car Forum', base_url: 'https://www.germancarforum.com/', platform_type: 'xenforo', vehicle_categories: ['german', 'audi', 'bmw', 'mercedes', 'porsche'] },
  { slug: '6speedonline', name: '6SpeedOnline', base_url: 'https://www.6speedonline.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['porsche', 'european', 'exotic'] },
  { slug: 'renntech', name: 'RennTech.org', base_url: 'https://www.renntech.org/forums/', platform_type: 'vbulletin', vehicle_categories: ['porsche'] },
  { slug: 'bimmerpost', name: 'Bimmerpost', base_url: 'https://www.bimmerpost.com/', platform_type: 'vbulletin', vehicle_categories: ['bmw'] },
  { slug: 'bimmerfest', name: 'Bimmerfest', base_url: 'https://www.bimmerfest.com/forums/', platform_type: 'xenforo', vehicle_categories: ['bmw'] },
  { slug: 'e46fanatics', name: 'E46 Fanatics', base_url: 'https://www.e46fanatics.com/', platform_type: 'vbulletin', vehicle_categories: ['bmw', 'e46'] },
  { slug: 'm3forum', name: 'M3 Forum', base_url: 'https://www.mforum.net/', platform_type: 'vbulletin', vehicle_categories: ['bmw', 'm3'] },
  { slug: 'm3cutters', name: 'M3cutters', base_url: 'https://forums.m3cutters.co.uk/', platform_type: 'xenforo', vehicle_categories: ['bmw', 'm3'] },
  { slug: 'm5board', name: 'M5Board', base_url: 'https://www.m5board.com/', platform_type: 'vbulletin', vehicle_categories: ['bmw', 'm5'] },
  { slug: 'bimmerboard', name: 'BimmerBoard', base_url: 'https://www.bimmerboard.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['bmw', 'e30'] },
  { slug: 'mbworld', name: 'MBWorld', base_url: 'https://mbworld.org/', platform_type: 'vbulletin', vehicle_categories: ['mercedes'] },
  { slug: 'peachparts', name: 'PeachParts Mercedes Forum', base_url: 'https://www.peachparts.com/shopforum/', platform_type: 'vbulletin', vehicle_categories: ['mercedes', 'vintage'] },
  { slug: 'benzforum', name: 'BenzForum', base_url: 'https://www.benzforum.com/forums/', platform_type: 'xenforo', vehicle_categories: ['mercedes'] },
  { slug: 'mymbonline', name: 'My MB Online', base_url: 'https://www.mymbonline.com/', platform_type: 'xenforo', vehicle_categories: ['mercedes'] },
  { slug: 'mercedesforum', name: 'Mercedes Forum', base_url: 'https://mercedesforum.com/forum/', platform_type: 'xenforo', vehicle_categories: ['mercedes'] },
  { slug: 'quattroworld', name: 'QuattroWorld', base_url: 'https://www.quattroworld.com/', platform_type: 'xenforo', vehicle_categories: ['audi'] },
  { slug: 'audi-sport', name: 'Audi-Sport.net', base_url: 'https://www.audi-sport.net/xf/', platform_type: 'xenforo', vehicle_categories: ['audi'] },
  { slug: 'audiforum-us', name: 'Audi Forum US', base_url: 'https://www.audiforum.us/', platform_type: 'xenforo', vehicle_categories: ['audi'] },
  { slug: 'audiworld', name: 'AudiWorld', base_url: 'https://www.audiworld.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['audi'] },
  { slug: 'audiforums', name: 'AudiForums', base_url: 'https://www.audiforums.com/forum/', platform_type: 'xenforo', vehicle_categories: ['audi'] },

  // === PROJECT CARS / BUILDS ===
  { slug: 'grassrootsmotorsports', name: 'Grassroots Motorsports', base_url: 'https://grassrootsmotorsports.com/forum/', platform_type: 'custom', vehicle_categories: ['builds', 'racing'] },
  { slug: 'classicmotorsports', name: 'Classic Motorsports', base_url: 'https://classicmotorsports.com/forum/', platform_type: 'custom', vehicle_categories: ['classic', 'builds'] },
  { slug: 'buildthreads', name: 'Build Threads', base_url: 'https://build-threads.com/', platform_type: 'custom', vehicle_categories: ['builds'] },

  // === SUBARU ===
  { slug: 'clubwrx', name: 'ClubWRX', base_url: 'https://www.clubwrx.net/', platform_type: 'xenforo', vehicle_categories: ['subaru', 'wrx'] },
  { slug: 'nasioc', name: 'NASIOC', base_url: 'https://forums.nasioc.com/', platform_type: 'vbulletin', vehicle_categories: ['subaru', 'impreza', 'wrx', 'sti'] },
  { slug: 'wrxforums', name: 'WRX Forums', base_url: 'https://www.wrxforums.com/forums/', platform_type: 'xenforo', vehicle_categories: ['subaru', 'wrx'] },
  { slug: 'impreza5', name: 'Impreza5', base_url: 'https://www.impreza5.com/forums/', platform_type: 'xenforo', vehicle_categories: ['subaru', 'impreza'] },
  { slug: 'iwsti', name: 'IW STI Forum', base_url: 'https://www.iwsti.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['subaru', 'sti'] },
  { slug: 'thesubaruforums', name: 'The Subaru Forums', base_url: 'https://www.thesubaruforums.com/', platform_type: 'xenforo', vehicle_categories: ['subaru'] },
  { slug: 'subaruxvforum', name: 'Subaru XV Forum', base_url: 'https://www.subaruxvforum.com/', platform_type: 'xenforo', vehicle_categories: ['subaru', 'crosstrek'] },

  // === NISSAN ===
  { slug: 'nissanclub', name: 'Nissan Club', base_url: 'https://www.nissanclub.com/forums/', platform_type: 'xenforo', vehicle_categories: ['nissan', 'infiniti'] },
  { slug: 'nicoclub', name: 'NICOclub', base_url: 'https://www.nicoclub.com/', platform_type: 'vbulletin', vehicle_categories: ['nissan', 'infiniti'] },
  { slug: 'nissanownersclub', name: 'Nissan Owners Club', base_url: 'https://www.nissanownersclub.com/forums/', platform_type: 'xenforo', vehicle_categories: ['nissan'] },
  { slug: 'clubarmada', name: 'Club Armada', base_url: 'https://www.clubarmada.com/forums/', platform_type: 'xenforo', vehicle_categories: ['nissan', 'infiniti'] },

  // === HONDA (additional) ===
  { slug: 'fitfreak', name: 'FitFreak', base_url: 'https://www.fitfreak.net/forums/', platform_type: 'vbulletin', vehicle_categories: ['honda', 'fit'] },
  { slug: '10thcivicforum', name: '10th Civic Forum', base_url: 'https://www.10thcivicforum.com/', platform_type: 'xenforo', vehicle_categories: ['honda', 'civic'] },
  { slug: 'civicxi', name: 'CivicXI', base_url: 'https://www.civicxi.com/forum/', platform_type: 'xenforo', vehicle_categories: ['honda', 'civic'] },
  { slug: 'hondacivicforum', name: 'Honda Civic Forum', base_url: 'https://www.hondacivicforum.com/forum/', platform_type: 'xenforo', vehicle_categories: ['honda', 'civic'] },
  { slug: 'civicforums', name: 'Civic Forums', base_url: 'https://www.civicforums.com/forums/', platform_type: 'xenforo', vehicle_categories: ['honda', 'civic'] },
  { slug: '9thgencivic', name: '9th Gen Civic Forum', base_url: 'https://www.9thgencivic.com/', platform_type: 'xenforo', vehicle_categories: ['honda', 'civic'] },
  { slug: 'crvownersclub', name: 'CRV Owners Club', base_url: 'https://www.crvownersclub.com/', platform_type: 'xenforo', vehicle_categories: ['honda', 'crv'] },

  // === OTHER MAKES ===
  { slug: 'miatanet', name: 'Miata.net', base_url: 'https://forum.miata.net/', platform_type: 'phpbb', vehicle_categories: ['mazda', 'miata'] },
  { slug: 'focusfanatics', name: 'FocusFanatics', base_url: 'https://www.focusfanatics.com/', platform_type: 'vbulletin', vehicle_categories: ['ford', 'focus'] },
  { slug: 'tdiclub', name: 'TDIclub', base_url: 'https://www.tdiclub.com/', platform_type: 'vbulletin', vehicle_categories: ['volkswagen', 'diesel'] },
  { slug: 'kiaforums', name: 'Kia Forums', base_url: 'https://www.kia-forums.com/', platform_type: 'xenforo', vehicle_categories: ['kia'] },
  { slug: 'bobistheoilguy', name: 'Bob Is The Oil Guy', base_url: 'https://bobistheoilguy.com/forums/', platform_type: 'xenforo', vehicle_categories: ['general', 'technical'] },
  { slug: 'fiestast', name: 'Fiesta ST OC', base_url: 'https://www.fiestastoc.com/', platform_type: 'xenforo', vehicle_categories: ['ford', 'fiesta'] },

  // === GENERAL AUTOMOTIVE ===
  { slug: 'automotiveforums', name: 'Automotive Forums', base_url: 'https://www.automotiveforums.com/', platform_type: 'vbulletin', vehicle_categories: ['general'] },
  { slug: 'carforum', name: 'CarForum', base_url: 'https://www.carforum.net/', platform_type: 'xenforo', vehicle_categories: ['general'] },
  { slug: 'gtplanet', name: 'GTPlanet', base_url: 'https://www.gtplanet.net/forum/', platform_type: 'xenforo', vehicle_categories: ['gaming', 'general'] },
];

async function main() {
  console.log(`Seeding ${FORUMS.length} forums...\n`);

  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const forum of FORUMS) {
    // Check if exists
    const { data: existing } = await supabase
      .from('forum_sources')
      .select('id')
      .eq('slug', forum.slug)
      .single();

    if (existing) {
      console.log(`⏭️  ${forum.slug}: already exists`);
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from('forum_sources')
      .insert({
        slug: forum.slug,
        name: forum.name,
        base_url: forum.base_url,
        platform_type: forum.platform_type,
        vehicle_categories: forum.vehicle_categories,
        inspection_status: 'pending',
      });

    if (error) {
      console.log(`❌ ${forum.slug}: ${error.message}`);
      errors++;
    } else {
      console.log(`✅ ${forum.slug}: added`);
      added++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Added: ${added}`);
  console.log(`Skipped (existing): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total in list: ${FORUMS.length}`);
}

main();
