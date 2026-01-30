#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Correct build section URLs for major forums
const forumFixes = {
  rennlist: [
    { name: '911 Forum', url: 'https://rennlist.com/forums/911-forum-56/' },
    { name: '993 Forum', url: 'https://rennlist.com/forums/993-forum-58/' },
    { name: '996 Forum', url: 'https://rennlist.com/forums/996-forum-60/' },
    { name: '997 Forum', url: 'https://rennlist.com/forums/997-forum-113/' },
    { name: '944 Forum', url: 'https://rennlist.com/forums/944-and-944s-forum-78/' },
    { name: '928 Forum', url: 'https://rennlist.com/forums/928-forum-69/' },
    { name: 'Boxster/Cayman 987', url: 'https://rennlist.com/forums/987-forum-125/' },
  ],
  corvetteforum: [
    { name: 'C1-C2-C3 Tech', url: 'https://www.corvetteforum.com/forums/c1-c2-and-c3-corvettes-1953-1982-tech-11/' },
    { name: 'C4 Tech', url: 'https://www.corvetteforum.com/forums/c4-corvettes-1984-1996-tech-24/' },
    { name: 'C5 Tech', url: 'https://www.corvetteforum.com/forums/c5-corvettes-1997-2004-tech-32/' },
    { name: 'C6 Tech', url: 'https://www.corvetteforum.com/forums/c6-corvettes-2005-2013-tech-43/' },
    { name: 'C7 Tech', url: 'https://www.corvetteforum.com/forums/c7-corvettes-2014-2019-tech-90/' },
  ],
  ls1tech: [
    { name: 'Project Build-Ups', url: 'https://www.ls1tech.com/forums/project-build-ups-32/' },
    { name: 'Conversions & Hybrids', url: 'https://www.ls1tech.com/forums/conversions-hybrids-33/' },
    { name: 'LS1/LS6 Engine Tech', url: 'https://www.ls1tech.com/forums/ls1-ls6-engine-tech-51/' },
  ],
  'honda-tech': [
    { name: 'Project Showcase', url: 'https://honda-tech.com/forums/project-showcase-118/' },
    { name: 'All Motor', url: 'https://honda-tech.com/forums/all-motor-naturally-aspirated-rates-11/' },
  ],
  rx7club: [
    { name: '3rd Gen', url: 'https://www.rx7club.com/3rd-generation-specific-1993-2002-702/' },
    { name: '2nd Gen', url: 'https://www.rx7club.com/2nd-generation-specific-1986-1992-702/' },
  ],
  's2ki': [
    { name: 'S2000 Talk', url: 'https://www.s2ki.com/forums/s2000-talk-1/' },
    { name: 'Forced Induction', url: 'https://www.s2ki.com/forums/s2000-forced-induction-rates-36/' },
  ],
  thirdgen: [
    { name: 'Build Threads', url: 'https://thirdgen.org/forums/build-threads-9/' },
    { name: 'Engine & Drivetrain', url: 'https://thirdgen.org/forums/engine-drivetrain-45/' },
  ],
  bimmerforums: [
    { name: 'E30 Forum', url: 'https://www.bimmerforums.com/forum/forumdisplay.php?68' },
    { name: 'E36 Forum', url: 'https://www.bimmerforums.com/forum/forumdisplay.php?71' },
    { name: 'E46 Forum', url: 'https://www.bimmerforums.com/forum/forumdisplay.php?74' },
  ],
  'pelican-parts': [
    { name: '911 Tech', url: 'https://forums.pelicanparts.com/porsche-911-technical-forum/' },
    { name: '944 Tech', url: 'https://forums.pelicanparts.com/porsche-944-turbo-turbo-s-944-s2-968-forum/' },
    { name: 'Boxster Tech', url: 'https://forums.pelicanparts.com/porsche-boxster-technical-forum/' },
  ],
};

async function main() {
  console.log('Updating forum build sections...');

  for (const [slug, sections] of Object.entries(forumFixes)) {
    const { data: forum } = await supabase
      .from('forum_sources')
      .select('id, dom_map')
      .eq('slug', slug)
      .single();

    if (!forum) {
      console.log(`${slug}: not found`);
      continue;
    }

    const updatedDomMap = {
      ...forum.dom_map,
      build_sections: sections,
    };

    const { error } = await supabase
      .from('forum_sources')
      .update({
        dom_map: updatedDomMap,
        inspection_status: 'active'
      })
      .eq('id', forum.id);

    console.log(`${slug}: ${error ? 'FAILED' : 'updated with ' + sections.length + ' sections'}`);
  }

  console.log('Done!');
}

main();
