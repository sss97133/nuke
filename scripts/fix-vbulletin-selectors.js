#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const vbulletinSelectors = {
  thread_list_selectors: {
    container: '#threadslist, [id^="threadbits_forum_"], #threads, ol.threads, body',
    thread_row: '.trow.text-center, .trow:has(a[id^="thread_title_"]), li.threadbit, tr[id^="thread_"]',
    thread_link: 'a[id^="thread_title_"], h4 a, a.title, h3.threadtitle a',
    thread_title: 'a[id^="thread_title_"], h4 a, a.title, h3.threadtitle a',
    author: '.author a, .username, .starter a, .threadstarter a',
    reply_count: '.counts span, td.alt2 a, .threadstats li:nth-child(1)',
    view_count: '.views, td.alt1, .threadstats li:nth-child(2)',
    last_post_date: '.lastpost .time, .lastpostdate, .lastpost-date',
  },
  post_selectors: {
    container: '#posts, .postlist, .posts-wrapper',
    post_wrapper: '.postcontainer, li.postbit, .postbitlegacy, div[id^="post_message_"], .post-row',
    author: '.username, .bigusername a, a.username, .post-author a',
    post_date: '.date, .postdate, .post-date',
    content: '.postcontent, .content, .postbody, div[id^="post_message_"], .post-content',
    images: '.postcontent img, .content img, .post-content img',
    post_id_attr: 'id',
  },
  pagination: {
    type: 'numbered',
    next_page_selector: 'a[rel="next"], .pagination a:last-child, .pagenav a:last-child',
    page_links_selector: '.pagination a, .pagenav a',
  }
};

// Forums to update with vBulletin selectors
const vbForums = [
  'rennlist', 'corvetteforum', 'ls1tech', 'honda-tech', 'rx7club',
  's2ki', 'thirdgen', 'bimmerforums', 'pelican-parts', 'lateral-g',
  'ft86club', 'audizine', '67-72chevytrucks'
];

async function main() {
  console.log('Updating vBulletin forum selectors...');

  for (const slug of vbForums) {
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
      ...vbulletinSelectors,
      build_sections: forum.dom_map?.build_sections || [],
    };

    const { error } = await supabase
      .from('forum_sources')
      .update({ dom_map: updatedDomMap })
      .eq('id', forum.id);

    console.log(`${slug}: ${error ? 'FAILED - ' + error.message : 'updated'}`);
  }

  console.log('Done!');
}

main();
