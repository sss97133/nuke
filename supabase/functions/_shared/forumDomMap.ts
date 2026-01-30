/**
 * Forum DOM Mapping Utilities
 *
 * Shared types and utilities for forum extraction.
 * Supports vBulletin, XenForo, phpBB, Discourse, and custom platforms.
 */

// =============================================================================
// TYPES
// =============================================================================

export type ForumPlatformType =
  | 'vbulletin'
  | 'xenforo'
  | 'phpbb'
  | 'discourse'
  | 'invision'
  | 'smf'
  | 'mybb'
  | 'custom';

export interface ForumDomMap {
  // Platform detection
  platform_type: ForumPlatformType;
  platform_version?: string;
  platform_signals: string[];  // What indicated this platform

  // Section discovery (garage, build journals, project cars sections)
  build_sections: BuildSection[];

  // Thread listing selectors
  thread_list_selectors: ThreadListSelectors;

  // Thread/post structure
  post_selectors: PostSelectors;

  // Pagination
  pagination: PaginationConfig;

  // Authentication
  auth: AuthConfig;

  // Custom extraction rules
  custom_rules?: CustomExtractionRule[];
}

export interface BuildSection {
  name: string;                    // "Project Cars", "Build Journals", "Garage"
  url: string;                     // Full URL to section
  path: string;                    // Path component for matching
  thread_count_estimate?: number;  // Estimated number of threads
  subsections?: BuildSection[];    // Nested sections
}

export interface ThreadListSelectors {
  // Container for thread listing
  container: string;               // CSS selector for thread list container

  // Individual thread row
  thread_row: string;              // CSS selector for each thread row
  thread_link: string;             // Selector for thread link (a element)
  thread_title: string;            // Selector for thread title text

  // Thread metadata
  author: string;                  // Thread author/starter
  author_link?: string;            // Link to author profile
  reply_count?: string;            // Number of replies
  view_count?: string;             // Number of views
  last_post_date?: string;         // Last post date
  last_post_author?: string;       // Last post author

  // Optional: sticky/pinned indicator
  is_sticky?: string;              // Selector indicating sticky thread

  // Optional: prefix/tag
  thread_prefix?: string;          // Thread prefix (e.g., "Build Journal:")
}

export interface PostSelectors {
  // Post container
  container: string;               // CSS selector for post container
  post_wrapper: string;            // Wrapper for individual post

  // Post identity
  post_id_attr?: string;           // Attribute containing post ID
  post_number?: string;            // Post number in thread

  // Author info
  author: string;                  // Post author username
  author_link?: string;            // Author profile link
  author_avatar?: string;          // Avatar image
  author_join_date?: string;       // Join date
  author_post_count?: string;      // Author's total posts
  author_location?: string;        // Author location

  // Post metadata
  post_date: string;               // Post timestamp
  post_date_attr?: string;         // Attribute with machine-readable date

  // Content
  content: string;                 // Main post content
  content_text_only?: string;      // Text-only variant (strips formatting)

  // Media
  images: string;                  // Image selector within post
  image_full_attr?: string;        // Attribute for full-size image URL
  attachments?: string;            // Attachment list
  embedded_video?: string;         // Embedded videos

  // Interactions
  quoted_content?: string;         // Quoted post content
  quote_author?: string;           // Who is being quoted
  likes_count?: string;            // Like/thanks count

  // Edit indicator
  edit_indicator?: string;         // Shows post was edited
}

export interface PaginationConfig {
  type: 'numbered' | 'load_more' | 'infinite_scroll' | 'show_all';

  // For numbered pagination
  next_page_selector?: string;     // "Next" link
  prev_page_selector?: string;     // "Previous" link
  page_links_selector?: string;    // All page number links
  current_page_selector?: string;  // Current page indicator

  // URL pattern for page navigation
  page_url_pattern?: string;       // e.g., "page-{n}" or "?page={n}"

  // For load more / infinite scroll
  load_more_button?: string;
  scroll_trigger_selector?: string;

  // Total pages/posts detection
  total_pages_selector?: string;
  total_posts_selector?: string;
}

export interface AuthConfig {
  requires_login: boolean;
  login_wall_indicators: string[];  // CSS selectors or text patterns
  login_url?: string;
  login_form_selector?: string;
  username_field?: string;
  password_field?: string;
}

export interface CustomExtractionRule {
  name: string;
  description?: string;
  selector: string;
  attribute?: string;              // Get attribute instead of text
  transform?: 'trim' | 'number' | 'date' | 'url';
  store_as: string;                // Field name in output
}

// =============================================================================
// PLATFORM DETECTION
// =============================================================================

export interface PlatformSignature {
  platform: ForumPlatformType;
  signals: string[];               // What to look for in HTML
  version_pattern?: RegExp;        // How to extract version
}

export const PLATFORM_SIGNATURES: PlatformSignature[] = [
  {
    platform: 'vbulletin',
    signals: [
      'vBulletin',
      'vb_',
      'vbmenu_popup',
      'showthread.php',
      'forumdisplay.php',
      'class="vbmenu_control"',
      'id="vB_Editor_',
      'vBulletin Solutions',
    ],
    version_pattern: /vBulletin[™®]?\s*(?:Version\s*)?(\d+\.\d+(?:\.\d+)?)/i,
  },
  {
    platform: 'xenforo',
    signals: [
      'XenForo',
      'xf-',
      'data-xf-',
      'XF.init',
      'xenforo',
      '/threads/',
      '/forums/',
      'class="block--messages"',
      'class="message-cell"',
    ],
    version_pattern: /XenForo[®™]?\s*(?:Ltd\.?\s*)?(?:Version\s*)?(\d+\.\d+(?:\.\d+)?)/i,
  },
  {
    platform: 'phpbb',
    signals: [
      'phpBB',
      'phpbb',
      'viewtopic.php',
      'viewforum.php',
      'class="postbody"',
      'id="phpbb"',
      'Powered by phpBB',
    ],
    version_pattern: /phpBB[®™]?\s*(?:Group\s*)?(?:Version\s*)?(\d+\.\d+(?:\.\d+)?)/i,
  },
  {
    platform: 'discourse',
    signals: [
      'Discourse',
      'discourse',
      'data-discourse-',
      '/t/',  // Discourse thread URL pattern
      'ember-application',
      'class="topic-body"',
      'class="cooked"',
    ],
    version_pattern: /Discourse\s*(?:Version\s*)?(\d+\.\d+(?:\.\d+)?)/i,
  },
  {
    platform: 'invision',
    signals: [
      'Invision',
      'IPS',
      'ipsType_',
      'ipsComment',
      'ipb_',
      'class="ipsWidget"',
      'Powered by Invision',
    ],
    version_pattern: /(?:Invision|IPS)\s*(?:Community\s*)?(?:Suite\s*)?(?:Version\s*)?(\d+\.\d+(?:\.\d+)?)/i,
  },
  {
    platform: 'smf',
    signals: [
      'Simple Machines',
      'SMF',
      'class="windowbg"',
      'index.php?topic=',
      'index.php?board=',
    ],
    version_pattern: /Simple Machines[®™]?\s*(?:Forum\s*)?(?:Version\s*)?(\d+\.\d+(?:\.\d+)?)/i,
  },
  {
    platform: 'mybb',
    signals: [
      'MyBB',
      'mybb_',
      'showthread.php',
      'forumdisplay.php',
      'class="post_content"',
    ],
    version_pattern: /MyBB[®™]?\s*(?:Version\s*)?(\d+\.\d+(?:\.\d+)?)/i,
  },
];

/**
 * Detect forum platform from HTML content
 */
export function detectPlatform(html: string): {
  platform: ForumPlatformType;
  version?: string;
  signals: string[];
  confidence: number;
} {
  const htmlLower = html.toLowerCase();
  const foundSignals: string[] = [];
  let bestMatch: PlatformSignature | null = null;
  let maxMatches = 0;

  for (const sig of PLATFORM_SIGNATURES) {
    const matches = sig.signals.filter(s =>
      htmlLower.includes(s.toLowerCase())
    );

    if (matches.length > maxMatches) {
      maxMatches = matches.length;
      bestMatch = sig;
      foundSignals.length = 0;
      foundSignals.push(...matches);
    }
  }

  if (!bestMatch || maxMatches === 0) {
    return {
      platform: 'custom',
      signals: [],
      confidence: 0
    };
  }

  // Try to extract version
  let version: string | undefined;
  if (bestMatch.version_pattern) {
    const versionMatch = html.match(bestMatch.version_pattern);
    if (versionMatch?.[1]) {
      version = versionMatch[1];
    }
  }

  // Calculate confidence based on signal matches
  const confidence = Math.min(1, maxMatches / 3);

  return {
    platform: bestMatch.platform,
    version,
    signals: foundSignals,
    confidence,
  };
}

// =============================================================================
// DEFAULT SELECTORS BY PLATFORM
// =============================================================================

export const DEFAULT_SELECTORS: Record<ForumPlatformType, Partial<ForumDomMap>> = {
  vbulletin: {
    thread_list_selectors: {
      container: '#threads, #threadslist, .threads',
      thread_row: '.threadbit, tr.thread',
      thread_link: 'a.thread-title, a[id^="thread_title_"]',
      thread_title: 'a.thread-title, a[id^="thread_title_"]',
      author: '.author a, .username',
      reply_count: '.replies, td.alt2[title*="Replies"]',
      view_count: '.views, td[title*="Views"]',
      last_post_date: '.lastpost, .lastpostdate',
    },
    post_selectors: {
      container: '#posts, .postlist',
      post_wrapper: '.postcontainer, .post, [id^="post_"]',
      post_id_attr: 'id',
      author: '.username, .bigusername, a[class*="username"]',
      author_link: '.username a, .bigusername',
      post_date: '.postdate, .date',
      content: '.postcontent, .postbody, [id^="post_message_"]',
      images: '.postcontent img, .attachthumb img',
      quoted_content: '.quote_container, .bbcode_quote',
    },
    pagination: {
      type: 'numbered',
      next_page_selector: 'a[rel="next"], .pagination a:contains(">")',
      page_links_selector: '.pagination a, .pagenav a',
      page_url_pattern: '/page{n}',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['You are not logged in', 'Register Now'],
    },
  },

  xenforo: {
    thread_list_selectors: {
      container: '.structItemContainer, .js-threadList',
      thread_row: '.structItem--thread, .discussionListItem',
      thread_link: '.structItem-title a, a[data-preview-url]',
      thread_title: '.structItem-title, .title a',
      author: '.structItem-minor a.username, .username',
      reply_count: '.structItem-cell--meta dd:first-of-type, .stats .major',
      view_count: '.structItem-cell--meta dd:last-of-type',
      last_post_date: '.structItem-latestDate, .lastPostInfo time',
    },
    post_selectors: {
      // California theme uses MessageCard, standard XenForo uses .message
      container: 'body',
      post_wrapper: '[id^="js-post-"], .js-post, .message, article[data-content="post"]',
      post_id_attr: 'id',
      // California theme author selectors
      author: '.MessageCard__user-info__name, .message-name a, .username',
      author_link: '.MessageCard__user-info__name, .message-name a',
      post_date: 'time[datetime], .MessageCard__date-created time, .message-date time',
      post_date_attr: 'datetime',
      // Content is in article.message-body with text in .bbWrapper
      content: 'article.message-body, .message-body .bbWrapper, .bbWrapper',
      images: '.message-body img, .bbWrapper img, img.bbImage, .attachedImages img',
      image_full_attr: 'data-url',
      quoted_content: '.bbCodeBlock--quote, blockquote.bbCodeQuote, blockquote',
    },
    pagination: {
      type: 'numbered',
      next_page_selector: 'a.pageNav-jump--next, a[rel="next"]',
      page_links_selector: '.pageNav-page a',
      page_url_pattern: '/page-{n}',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['You must be logged-in', 'You must register'],
    },
  },

  phpbb: {
    thread_list_selectors: {
      container: '.topiclist, #viewforum',
      thread_row: '.row, li.row',
      thread_link: '.topictitle',
      thread_title: '.topictitle',
      author: '.topic-poster a, .author a',
      reply_count: '.posts, dd.posts',
      view_count: '.views, dd.views',
      last_post_date: '.lastpost, .topic-last-post time',
    },
    post_selectors: {
      container: '#viewtopic, .post-list',
      post_wrapper: '.post, .postbody',
      post_id_attr: 'id',
      author: '.postprofile .username, .postauthor',
      author_link: '.postprofile .username',
      post_date: '.postdate, time',
      content: '.postbody .content, .postcontent',
      images: '.postbody img, .attachbox img',
      quoted_content: 'blockquote, .quotecontent',
    },
    pagination: {
      type: 'numbered',
      next_page_selector: 'a.next',
      page_links_selector: '.pagination a',
      page_url_pattern: '&start={n}',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['You must be registered', 'Login'],
    },
  },

  discourse: {
    thread_list_selectors: {
      container: '.topic-list, #list-area',
      thread_row: '.topic-list-item, tr[data-topic-id]',
      thread_link: '.title a, .topic-title a',
      thread_title: '.title a, .topic-title',
      author: '.posters a:first-child',
      reply_count: '.posts-map, .num.posts',
      view_count: '.views, .num.views',
      last_post_date: '.relative-date',
    },
    post_selectors: {
      container: '.post-stream, .topic-body',
      post_wrapper: '.topic-post, article[data-post-id]',
      post_id_attr: 'data-post-id',
      author: '.username a, .names .username',
      author_link: '.username a',
      post_date: '.relative-date, time',
      post_date_attr: 'datetime',
      content: '.cooked, .post-body .cooked',
      images: '.cooked img:not(.emoji)',
      quoted_content: '.quote, blockquote.quote',
    },
    pagination: {
      type: 'infinite_scroll',
      scroll_trigger_selector: '.topic-body',
      total_posts_selector: '.topic-map .posts-count',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['log in to continue', 'Sign Up'],
    },
  },

  invision: {
    thread_list_selectors: {
      container: '.ipsDataList, .cTopicList',
      thread_row: '.ipsDataItem, .cTopicRow',
      thread_link: '.ipsDataItem_title a, .cTopicRow a.title',
      thread_title: '.ipsDataItem_title, .cTopicRow .title',
      author: '.ipsDataItem_main a.ipsType_normal, .cTopicRow .starter',
      reply_count: '.ipsDataItem_stats_number, .cTopicRow .replies',
      view_count: '.ipsDataItem_stats_number:last-child',
      last_post_date: '.ipsDataItem_lastPoster time',
    },
    post_selectors: {
      container: '.cTopic, .ipsComment_content',
      post_wrapper: '.ipsComment, .cPost',
      post_id_attr: 'data-commentid',
      author: '.ipsComment_author a, .cAuthorPane_main a',
      author_link: '.ipsComment_author a',
      post_date: 'time[datetime], .ipsComment_meta time',
      post_date_attr: 'datetime',
      content: '.ipsComment_content .ipsType_richText, .cPost_content',
      images: '.ipsComment_content img',
      quoted_content: '.ipsQuote, blockquote.ipsQuote',
    },
    pagination: {
      type: 'numbered',
      next_page_selector: 'a[rel="next"]',
      page_links_selector: '.ipsPagination_page a',
      page_url_pattern: '/page/{n}/',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['Sign In', 'You must be a member'],
    },
  },

  smf: {
    thread_list_selectors: {
      container: '#messageindex, .topic_table',
      thread_row: '.windowbg, .windowbg2',
      thread_link: 'a[href*="topic="]',
      thread_title: 'a[href*="topic="]',
      author: '.starter a, .lastpost a:first-child',
      reply_count: '.stats',
      view_count: '.stats',
      last_post_date: '.lastpost',
    },
    post_selectors: {
      container: '#forumposts, .topic',
      post_wrapper: '.post_wrapper, .windowbg, .windowbg2',
      author: '.poster h4 a, .poster_info a',
      author_link: '.poster h4 a',
      post_date: '.smalltext, .keyinfo .smalltext',
      content: '.post, .inner',
      images: '.post img, .bbc_img',
      quoted_content: '.quoteheader + .quote, .bbc_standard_quote',
    },
    pagination: {
      type: 'numbered',
      next_page_selector: 'a.navPages:last-child',
      page_links_selector: 'a.navPages',
      page_url_pattern: '.{n}',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['Please login', 'You are not logged in'],
    },
  },

  mybb: {
    thread_list_selectors: {
      container: '#threads, .threads',
      thread_row: '.thread, tr.inline_row',
      thread_link: '.subject a, a[id^="tid_"]',
      thread_title: '.subject a',
      author: '.author a',
      reply_count: '.trow_replies',
      view_count: '.trow_views',
      last_post_date: '.lastpost span',
    },
    post_selectors: {
      container: '#posts, .posts',
      post_wrapper: '.post, [id^="post_"]',
      post_id_attr: 'id',
      author: '.post_author a, .largetext a',
      author_link: '.post_author a',
      post_date: '.post_date',
      content: '.post_body, .post_content',
      images: '.post_body img',
      quoted_content: 'blockquote, .quote_body',
    },
    pagination: {
      type: 'numbered',
      next_page_selector: 'a.pagination_next',
      page_links_selector: '.pagination a',
      page_url_pattern: '?page={n}',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['You are not logged in', 'Login to post'],
    },
  },

  custom: {
    thread_list_selectors: {
      container: 'body',
      thread_row: 'a',
      thread_link: 'a',
      thread_title: 'a',
      author: '',
    },
    post_selectors: {
      container: 'body',
      post_wrapper: 'article, .post, .comment, .message',
      author: '.author, .username, .user',
      post_date: 'time, .date, .timestamp',
      content: '.content, .body, .text, .message-body, p',
      images: 'img',
    },
    pagination: {
      type: 'numbered',
      next_page_selector: 'a[rel="next"], .next, .pagination a:last-child',
      page_links_selector: '.pagination a, .pager a',
    },
    auth: {
      requires_login: false,
      login_wall_indicators: ['login', 'sign in', 'register'],
    },
  },
};

// =============================================================================
// BUILD THREAD DETECTION
// =============================================================================

/**
 * Keywords that indicate a build thread
 */
export const BUILD_THREAD_KEYWORDS = [
  // Direct indicators
  'build', 'project', 'restoration', 'restore', 'rebuild',
  'restomod', 'resto-mod', 'refresh', 'overhaul',

  // Progress indicators
  'journal', 'thread', 'progress', 'diary', 'log',
  'wip', 'work in progress',

  // Vehicle-specific
  'swap', 'ls swap', 'turbo build', 'track build',
  'street build', 'show build', 'race build',
  'barn find', 'garage find',

  // Completion indicators (in OP)
  'finished', 'completed', 'done', 'before and after',
  'transformation', 'finally done',
];

/**
 * Section names that typically contain build threads
 */
export const BUILD_SECTION_KEYWORDS = [
  'garage', 'garages', 'member garage', 'members garage',
  'build', 'builds', 'build thread', 'build threads',
  'project', 'projects', 'project car', 'project cars',
  'journal', 'journals', 'build journal',
  'restoration', 'restorations', 'restoration log',
  'showcase', 'member showcase',
  'registry', 'member registry',
  'featured', 'featured builds',
];

/**
 * Check if a thread title looks like a build thread
 */
export function isBuildThreadTitle(title: string): {
  isBuild: boolean;
  confidence: number;
  matchedKeywords: string[];
} {
  const titleLower = title.toLowerCase();
  const matchedKeywords: string[] = [];

  // Check for year + make pattern (strong signal)
  const hasYearMake = /\b(19|20)\d{2}\b.*\b[A-Z][a-z]+/.test(title);

  // Check for build keywords
  for (const kw of BUILD_THREAD_KEYWORDS) {
    if (titleLower.includes(kw)) {
      matchedKeywords.push(kw);
    }
  }

  // Calculate confidence
  let confidence = 0;
  if (hasYearMake) confidence += 0.4;
  if (matchedKeywords.length > 0) confidence += 0.3;
  if (matchedKeywords.length > 1) confidence += 0.2;
  if (matchedKeywords.length > 2) confidence += 0.1;

  return {
    isBuild: confidence >= 0.4,
    confidence: Math.min(1, confidence),
    matchedKeywords,
  };
}

/**
 * Check if a section URL/name is a build section
 */
export function isBuildSection(name: string, url: string): boolean {
  const combined = `${name} ${url}`.toLowerCase();
  return BUILD_SECTION_KEYWORDS.some(kw => combined.includes(kw));
}

// =============================================================================
// VEHICLE HINT EXTRACTION
// =============================================================================

export interface VehicleHints {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  color?: string;
  engine?: string;
  transmission?: string;
}

/**
 * Extract vehicle hints from thread title or content
 */
export function extractVehicleHints(text: string): VehicleHints {
  const hints: VehicleHints = {};

  // Year extraction (1920-2030)
  const yearMatch = text.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  if (yearMatch) {
    hints.year = parseInt(yearMatch[1], 10);
  }

  // VIN extraction (17 chars, specific pattern)
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) {
    hints.vin = vinMatch[1].toUpperCase();
  }

  // Common makes (will be expanded)
  const makes = [
    'Porsche', 'Ferrari', 'Lamborghini', 'Chevrolet', 'Chevy', 'Ford',
    'Dodge', 'Plymouth', 'Pontiac', 'Oldsmobile', 'Buick', 'Cadillac',
    'BMW', 'Mercedes', 'Audi', 'Volkswagen', 'VW', 'Toyota', 'Honda',
    'Nissan', 'Datsun', 'Mazda', 'Subaru', 'Mitsubishi',
    'Jaguar', 'Aston Martin', 'Lotus', 'Triumph', 'MG', 'Austin Healey',
    'Alfa Romeo', 'Fiat', 'Maserati', 'Lancia',
    'AMC', 'Jeep', 'International', 'GMC', 'Land Rover', 'Range Rover',
  ];

  for (const make of makes) {
    const makePattern = new RegExp(`\\b${make}\\b`, 'i');
    if (makePattern.test(text)) {
      hints.make = make.replace(/^Chevy$/i, 'Chevrolet').replace(/^VW$/i, 'Volkswagen');
      break;
    }
  }

  // Common model patterns
  const modelPatterns = [
    // Porsche
    /\b(911|912|914|944|928|968|356|924|Boxster|Cayman|Cayenne|Panamera|Macan|918)\b/i,
    // Chevrolet
    /\b(Camaro|Corvette|Chevelle|Nova|Impala|Bel Air|Monte Carlo|El Camino|C10|K10|C20|K20|Blazer|Suburban)\b/i,
    // Ford
    /\b(Mustang|F-?1[05]0|Bronco|Falcon|Fairlane|Galaxie|Thunderbird|GT40)\b/i,
    // Dodge/Plymouth/Mopar
    /\b(Challenger|Charger|Cuda|Barracuda|Dart|Duster|Road Runner|GTX|Super Bee)\b/i,
    // BMW
    /\b(M3|M5|M6|E30|E36|E46|E90|E92|2002|3\.0CS|3\.0CSL)\b/i,
    // Japanese
    /\b(240Z|260Z|280Z|300ZX|Supra|Celica|MR2|AE86|Corolla|Civic|CRX|NSX|S2000|RX-?7|Miata|MX-?5)\b/i,
  ];

  for (const pattern of modelPatterns) {
    const match = text.match(pattern);
    if (match) {
      hints.model = match[1];
      break;
    }
  }

  // Color extraction
  const colors = [
    'black', 'white', 'silver', 'gray', 'grey', 'red', 'blue', 'green',
    'yellow', 'orange', 'brown', 'tan', 'beige', 'gold', 'bronze',
    'maroon', 'burgundy', 'navy', 'purple', 'pink',
    'guards red', 'racing green', 'british racing green', 'arrest me red',
    'grabber blue', 'hugger orange', 'sublime green', 'plum crazy',
    'hemi orange', 'go mango', 'tor red', 'signal green',
  ];

  for (const color of colors) {
    const colorPattern = new RegExp(`\\b${color}\\b`, 'i');
    if (colorPattern.test(text)) {
      hints.color = color.split(' ').map(w =>
        w.charAt(0).toUpperCase() + w.slice(1)
      ).join(' ');
      break;
    }
  }

  // Transmission
  const transPatterns = [
    { pattern: /\b(manual|stick|5-?speed|6-?speed|4-?speed|3-?speed)\b/i, value: 'Manual' },
    { pattern: /\b(automatic|auto|slushbox|powerglide|turbo\s*400|th400|th350)\b/i, value: 'Automatic' },
  ];

  for (const { pattern, value } of transPatterns) {
    if (pattern.test(text)) {
      hints.transmission = value;
      break;
    }
  }

  return hints;
}

// =============================================================================
// URL UTILITIES
// =============================================================================

/**
 * Normalize a forum URL for matching/deduplication
 */
export function normalizeForumUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove common tracking params
    const removeParams = ['sid', 'highlight', 'utm_source', 'utm_medium', 'utm_campaign', 'fbclid'];
    removeParams.forEach(p => u.searchParams.delete(p));
    // Normalize trailing slash
    u.pathname = u.pathname.replace(/\/+$/, '');
    // Remove fragment
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Extract forum domain for source identification
 */
export function extractForumDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Check if URL looks like a thread URL (vs. section/forum listing)
 */
export function isThreadUrl(url: string): boolean {
  const threadPatterns = [
    /\/threads?\//i,
    /\/showthread\.php/i,
    /\/viewtopic\.php/i,
    /\/topic\//i,
    /\/t\//i,  // Discourse
    /\?topic=/i,
    /\/topic-/i,
    /\/\d+-[^\/]+\.html$/i,  // vBulletin: /forums/section/123-title.html
    /\/\d+\/$/i,  // Simple numeric thread IDs
    /forumdisplay\.php.*\?.*t=/i,  // vBulletin with thread ID param
  ];

  return threadPatterns.some(p => p.test(url));
}
