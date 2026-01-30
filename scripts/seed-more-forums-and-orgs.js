#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// New forums to add
const NEW_FORUMS = [
  // Niche/Specialty
  { slug: 'trifive', name: 'Tri Five Forum', base_url: 'https://www.trifive.com/forums/', platform_type: 'vbulletin', vehicle_categories: ['chevrolet', '1955-1957'] },
  { slug: 'chevytalk', name: 'ChevyTalk', base_url: 'https://www.chevytalk.org/', platform_type: 'vbulletin', vehicle_categories: ['chevrolet', 'antique'] },
  { slug: 'moparchat', name: 'MoparChat', base_url: 'https://www.moparchat.com/', platform_type: 'vbulletin', vehicle_categories: ['mopar', 'hemi', 'dodge', 'chrysler'] },
  { slug: 'teamchevelle', name: 'Team Chevelle', base_url: 'https://www.teamchevelle.com/', platform_type: 'vbulletin', vehicle_categories: ['chevrolet', 'chevelle'] },

  // International
  { slug: 'britishcarforum', name: 'British Car Forum', base_url: 'https://www.britishcarforum.com/community/', platform_type: 'xenforo', vehicle_categories: ['british', 'mg', 'triumph', 'jaguar'] },
  { slug: 'aussiefrogs', name: 'Aussiefrogs', base_url: 'https://www.aussiefrogs.com/', platform_type: 'xenforo', vehicle_categories: ['french', 'peugeot', 'renault', 'citroen'] },
  { slug: 'cliosport', name: 'ClioSport', base_url: 'https://www.cliosport.net/', platform_type: 'xenforo', vehicle_categories: ['renault', 'clio', 'uk'] },

  // Racing/Track
  { slug: 'trackforum', name: 'TrackForum', base_url: 'https://www.trackforum.org/', platform_type: 'xenforo', vehicle_categories: ['racing', 'f1', 'motogp'] },
  { slug: 'racingforums', name: 'Racing Forums', base_url: 'https://racing-forums.com/', platform_type: 'xenforo', vehicle_categories: ['nascar', 'indycar', 'racing'] },
  { slug: 'tentenths', name: 'TenTenths Motorsport', base_url: 'https://www.tentenths.com/', platform_type: 'vbulletin', vehicle_categories: ['racing', 'motorsport'] },
  { slug: 'trackmustangs', name: 'Track Mustangs Online', base_url: 'https://trackmustangsonline.com/forums/', platform_type: 'xenforo', vehicle_categories: ['mustang', 'track', 'gt350', 'gt500'] },

  // EV Conversion
  { slug: 'diyelectriccar', name: 'DIY Electric Car Forums', base_url: 'https://www.diyelectriccar.com/forums/', platform_type: 'xenforo', vehicle_categories: ['ev', 'conversion', 'electric'] },
  { slug: 'speakev', name: 'Speak EV', base_url: 'https://www.speakev.com/', platform_type: 'xenforo', vehicle_categories: ['ev', 'electric'] },

  // Air-Cooled VW/Porsche
  { slug: 'volkszone', name: 'Volkszone', base_url: 'https://www.volkszone.com/', platform_type: 'vbulletin', vehicle_categories: ['vw', 'aircooled', 'beetle'] },
  { slug: 'ultimateaircooled', name: 'Ultimate Aircooled', base_url: 'https://www.ultimateaircooled.com/forums/', platform_type: 'xenforo', vehicle_categories: ['vw', 'aircooled'] },
  { slug: 'porsche356registry', name: 'Porsche 356 Registry Forum', base_url: 'https://forum.porsche356registry.org/', platform_type: 'xenforo', vehicle_categories: ['porsche', '356'] },

  // Mopar/Orphan
  { slug: 'allpar', name: 'Allpar Forums', base_url: 'https://www.allpar.com/forums/', platform_type: 'xenforo', vehicle_categories: ['mopar', 'dodge', 'jeep', 'chrysler', 'amc'] },
  { slug: 'forcbodiesonly', name: 'For C Bodies Only', base_url: 'https://www.forcbodiesonly.com/', platform_type: 'vbulletin', vehicle_categories: ['mopar', 'chrysler', 'c-body'] },
  { slug: 'studebakerdriversclub', name: 'Studebaker Drivers Club Forum', base_url: 'https://forum.studebakerdriversclub.com/', platform_type: 'xenforo', vehicle_categories: ['studebaker', 'orphan'] },

  // Kit Cars
  { slug: 'factoryfive', name: 'Factory Five Racing Forum', base_url: 'https://www.factoryfive.com/forum/', platform_type: 'xenforo', vehicle_categories: ['kitcar', 'replica', 'cobra'] },
  { slug: 'madaboutkitcars', name: 'Madabout Kitcars', base_url: 'https://forum.madabout-kitcars.com/', platform_type: 'phpbb', vehicle_categories: ['kitcar', 'roadster'] },
  { slug: 'gt40s', name: 'GT40s Forum', base_url: 'https://gt40s.com/forum/', platform_type: 'xenforo', vehicle_categories: ['gt40', 'replica', 'ford'] },

  // Van Conversion
  { slug: 'vanlivingforum', name: 'Van & RV Living Forum', base_url: 'https://vanlivingforum.com/', platform_type: 'xenforo', vehicle_categories: ['van', 'camper', 'conversion'] },
  { slug: 'fordtransitusa', name: 'Ford Transit USA Forum', base_url: 'https://www.fordtransitusaforum.com/', platform_type: 'xenforo', vehicle_categories: ['ford', 'transit', 'camper'] },
  { slug: 'promasterforum', name: 'Ram Promaster Forum', base_url: 'https://www.promasterforum.com/', platform_type: 'xenforo', vehicle_categories: ['ram', 'promaster', 'camper'] },
  { slug: 'projectvanlife', name: 'Project Van Life Forum', base_url: 'https://forum.projectvanlife.com/', platform_type: 'discourse', vehicle_categories: ['van', 'camper', 'conversion'] },
  { slug: 'classbforums', name: 'Class B Forums', base_url: 'https://www.classbforum.com/', platform_type: 'xenforo', vehicle_categories: ['rv', 'classb', 'camper'] },

  // Additional specialty
  { slug: 'classicnation', name: 'Classic Nation', base_url: 'https://www.classicnation.com/forums/', platform_type: 'xenforo', vehicle_categories: ['classic', 'restoration'] },
  { slug: 'mustangclubamerica', name: 'Mustang Club of America', base_url: 'https://www.mustang.org/forums/', platform_type: 'xenforo', vehicle_categories: ['mustang', 'ford'] },
  { slug: 'modeltforum', name: 'Model T Ford Club Forum', base_url: 'https://www.mtfca.com/discus/', platform_type: 'custom', vehicle_categories: ['ford', 'modelt', 'antique'] },
];

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  console.log('═'.repeat(60));
  console.log('SEEDING FORUMS + CREATING ORG PROFILES');
  console.log('═'.repeat(60));

  // 1. Add new forums
  console.log('\n📥 Adding new forums...');
  let forumsAdded = 0;

  for (const forum of NEW_FORUMS) {
    const { data: existing } = await supabase
      .from('forum_sources')
      .select('id')
      .eq('slug', forum.slug)
      .single();

    if (!existing) {
      const { error } = await supabase
        .from('forum_sources')
        .insert({
          ...forum,
          inspection_status: 'pending',
        });

      if (!error) {
        forumsAdded++;
        console.log(`  ✅ ${forum.slug}`);
      }
    }
  }
  console.log(`  Added ${forumsAdded} new forums`);

  // 2. Get all forums and create org profiles
  console.log('\n🏢 Creating org profiles for forums...');

  const { data: forums } = await supabase
    .from('forum_sources')
    .select('id, slug, name, base_url, platform_type, vehicle_categories');

  let orgsCreated = 0;
  let orgsExisted = 0;

  for (const forum of forums || []) {
    const orgSlug = `forum-${forum.slug}`;

    // Check if org exists
    const { data: existingOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', orgSlug)
      .single();

    if (existingOrg) {
      orgsExisted++;
      continue;
    }

    // Create org profile
    const { error } = await supabase
      .from('organizations')
      .insert({
        slug: orgSlug,
        name: forum.name,
        org_type: 'forum',
        website_url: forum.base_url,
        description: `Automotive enthusiast forum - ${forum.platform_type || 'unknown'} platform`,
        metadata: {
          forum_source_id: forum.id,
          platform_type: forum.platform_type,
          vehicle_categories: forum.vehicle_categories,
          is_forum: true,
        },
      });

    if (!error) {
      orgsCreated++;
    }
  }

  console.log(`  Created ${orgsCreated} new org profiles`);
  console.log(`  ${orgsExisted} already existed`);

  // 3. Summary
  const { count: totalForums } = await supabase
    .from('forum_sources')
    .select('*', { count: 'exact', head: true });

  const { count: totalOrgs } = await supabase
    .from('organizations')
    .select('*', { count: 'exact', head: true });

  const { count: forumOrgs } = await supabase
    .from('organizations')
    .select('*', { count: 'exact', head: true })
    .eq('org_type', 'forum');

  console.log('\n' + '═'.repeat(60));
  console.log('📦 INVENTORY UPDATED');
  console.log('═'.repeat(60));
  console.log(`  Forums:        ${totalForums}`);
  console.log(`  Forum Orgs:    ${forumOrgs}`);
  console.log(`  Total Orgs:    ${totalOrgs}`);
  console.log('═'.repeat(60));
}

main();
