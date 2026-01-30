#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// XenForo 2.x selectors (modern forums)
const xenforoSelectors = {
  thread_list_selectors: {
    container: '.structItemContainer, .block-body, [data-widget-section="content"], .p-body-content, body',
    thread_row: '.structItem--thread, .structItem[data-author], div[class*="structItem"]',
    thread_link: '.structItem-title a, a[data-preview-url], .contentRow-title a',
    thread_title: '.structItem-title a, a[data-preview-url], .contentRow-title a',
    author: '.structItem-minor a.username, .username[data-user-id], a[data-user-id]',
    reply_count: '.structItem-cell--meta dd, .pairs--justified dd:first-child',
    view_count: '.structItem-cell--meta dd:last-child, .pairs--justified dd:last-child',
    last_post_date: '.structItem-latestDate, time.u-dt, .lastThreadDate',
  },
  post_selectors: {
    container: '.block-body, .p-body-content, article.message',
    post_wrapper: 'article.message, .message--post, div[data-content="post"]',
    author: '.message-name a, .message-userDetails a.username, a[data-user-id]',
    post_date: '.message-date time, time.u-dt, .message-attribution time',
    content: '.message-body .bbWrapper, .message-content .bbWrapper, .message-body article',
    images: '.message-body img, .bbImage, .message-content img',
    post_id_attr: 'data-content',
  },
  pagination: {
    type: 'numbered',
    next_page_selector: 'a.pageNav-jump--next, .pageNav-main a:last-child, a[rel="next"]',
    page_links_selector: '.pageNav-page a, .pageNav-main a',
  },
};

// XenForo 1.x selectors (older forums)
const xenforoLegacySelectors = {
  thread_list_selectors: {
    container: '.discussionList, #content .messageList, .forum_list, body',
    thread_row: '.discussionListItem, li[id^="thread-"]',
    thread_link: '.PreviewTooltip, h3.title a, .listBlock.main a.title',
    thread_title: '.PreviewTooltip, h3.title a, .listBlock.main a.title',
    author: '.username, .posterDate a.username',
    reply_count: '.stats .major dd, .stats dd:first-child',
    view_count: '.stats .minor dd, .stats dd:last-child',
    last_post_date: '.lastPostInfo .DateTime, .lastPost .DateTime',
  },
  post_selectors: {
    container: '.messageList, #messageList',
    post_wrapper: '.message, li.message[id^="post-"]',
    author: '.username, .messageMeta a.username',
    post_date: '.DateTime, .messageMeta .DateTime',
    content: '.messageContent, .messageText',
    images: '.messageContent img, .attachedImages img',
    post_id_attr: 'id',
  },
  pagination: {
    type: 'numbered',
    next_page_selector: 'a.text[rel="next"], .PageNav a:last-child',
    page_links_selector: '.PageNav a, .pageNavLink',
  },
};

// Forums known to be XenForo 2.x
const xenforo2Forums = [
  '10thcivicforum', '4runners', '4runner-forums', '5thgenrams', '9thgencivic',
  'audiforums', 'audiforum-us', 'audi-sport', 'benzforum', 'bimmerfest',
  'bobistheoilguy', 'broncozone', 'buickforums', 'carforum', 'civicforums',
  'civicx', 'civicxi', 'clubarmada', 'clubroadster', 'clubwrx', 'crvownersclub',
  'driftworks', 'dsmtuners', 'f150-forums', 'ferrarichat', 'fiestast',
  'germancarforum', 'gm-trucks', 'gtplanet', 'hondacivicforum', 'impreza5',
  'infinitiforum', 'jeepgladiatorforum', 'jlwranglerforums', 'kiaforums',
  'm3cutters', 'mercedesforum', 'mymbonline', 'nassanclub', 'nissanownersclub',
  'offroadpassport', 'offroadtb', 'overlandbound', 'quattroworld', 'tacoma4g',
  'tacomaworld', 'thesubaruforums', 'thetruckstop', 'toyotanation', 'wrxforums',
  'wranglertjforum', 'camaros-net', 'chevelles', 'nastyz28', 'vwvortex',
];

// Forums known to be XenForo 1.x (legacy)
const xenforo1Forums = [
  'alfabb', 'benzworld', 'bimmerpost', 'dieselplace', 'digitalcorvettes',
  'e46fanatics', 'expeditionportal', 'focusfanatics', 'fordmuscleforums',
  'forabodiesonly', 'forbbodiesonly', 'gmfullsize', 'hotrodders', 'hybridz',
  'ih8mud', 'iwsti', 'jaguarforum', 'jeepforum', 'lateral-g', 'lotustalk',
  'm5board', 'mazdas247', 'moparts', 'mr2oc', 'peachparts', 'pelican-parts',
  'pirate4x4', 'planet-9', 'pro-touring', 'ratsun', 'renntech', 'smokinvette',
  'supraforums', 'tdiclub', 'thedieselstop', 'thesamba', 'trifive', 'triumphs',
  'ttora', 'vintage-mustang', 'wranglerforum', 'yellowbullet', 'team-integra',
];

async function main() {
  console.log('Updating XenForo forum selectors...\n');

  let updated = 0;
  let skipped = 0;

  // Update XenForo 2.x forums
  console.log('=== XenForo 2.x Forums ===');
  for (const slug of xenforo2Forums) {
    const { data: forum } = await supabase
      .from('forum_sources')
      .select('id, dom_map')
      .eq('slug', slug)
      .single();

    if (!forum) {
      console.log(`⏭️  ${slug}: not found`);
      skipped++;
      continue;
    }

    const updatedDomMap = {
      ...forum.dom_map,
      ...xenforoSelectors,
      build_sections: forum.dom_map?.build_sections || [],
    };

    const { error } = await supabase
      .from('forum_sources')
      .update({
        dom_map: updatedDomMap,
        platform_type: 'xenforo',
      })
      .eq('id', forum.id);

    if (error) {
      console.log(`❌ ${slug}: ${error.message}`);
    } else {
      console.log(`✅ ${slug}: updated with XenForo 2.x selectors`);
      updated++;
    }
  }

  // Update XenForo 1.x forums
  console.log('\n=== XenForo 1.x Forums ===');
  for (const slug of xenforo1Forums) {
    const { data: forum } = await supabase
      .from('forum_sources')
      .select('id, dom_map')
      .eq('slug', slug)
      .single();

    if (!forum) {
      console.log(`⏭️  ${slug}: not found`);
      skipped++;
      continue;
    }

    const updatedDomMap = {
      ...forum.dom_map,
      ...xenforoLegacySelectors,
      build_sections: forum.dom_map?.build_sections || [],
    };

    const { error } = await supabase
      .from('forum_sources')
      .update({
        dom_map: updatedDomMap,
        platform_type: 'xenforo',
      })
      .eq('id', forum.id);

    if (error) {
      console.log(`❌ ${slug}: ${error.message}`);
    } else {
      console.log(`✅ ${slug}: updated with XenForo 1.x selectors`);
      updated++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped/Not Found: ${skipped}`);
}

main();
