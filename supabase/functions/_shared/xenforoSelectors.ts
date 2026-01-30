/**
 * XenForo Forum Selectors
 *
 * XenForo is the most common modern forum platform.
 * These selectors work for XenForo 2.x forums.
 */

export const xenforoSelectors = {
  thread_list_selectors: {
    // Thread listing containers
    container: '.structItemContainer, .block-body, [data-widget-section="content"], .p-body-content',

    // Individual thread rows
    thread_row: '.structItem--thread, .structItem[data-author], div[class*="structItem"]',

    // Thread link and title
    thread_link: '.structItem-title a, a[data-preview-url], .contentRow-title a',
    thread_title: '.structItem-title a, a[data-preview-url], .contentRow-title a',

    // Author info
    author: '.structItem-minor a.username, .username[data-user-id], a[data-user-id]',

    // Stats
    reply_count: '.structItem-cell--meta dd, .pairs--justified dd:first-child, .structItem-statistic:first-child',
    view_count: '.structItem-cell--meta dd:last-child, .pairs--justified dd:last-child, .structItem-statistic:last-child',
    last_post_date: '.structItem-latestDate, time.u-dt, .lastThreadDate',
  },

  post_selectors: {
    // Post containers
    container: '.block-body, .p-body-content, article.message',
    post_wrapper: 'article.message, .message--post, div[data-content="post"]',

    // Post metadata
    author: '.message-name a, .message-userDetails a.username, a[data-user-id]',
    post_date: '.message-date time, time.u-dt, .message-attribution time',

    // Content
    content: '.message-body .bbWrapper, .message-content .bbWrapper, .message-body article',
    images: '.message-body img, .bbImage, .message-content img',

    // Post identification
    post_id_attr: 'data-content',
  },

  pagination: {
    type: 'numbered',
    next_page_selector: 'a.pageNav-jump--next, .pageNav-main a:last-child, a[rel="next"]',
    page_links_selector: '.pageNav-page a, .pageNav-main a',
    page_param: 'page',
  },
};

/**
 * XenForo 1.x selectors (older forums)
 */
export const xenforoLegacySelectors = {
  thread_list_selectors: {
    container: '.discussionList, #content .messageList, .forum_list',
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
    page_param: 'page',
  },
};

/**
 * Regex patterns for extracting threads from XenForo HTML
 * Used as fallback when DOM selectors don't work
 */
export const xenforoRegexPatterns = {
  // XenForo 2.x thread links
  threadUrl: /href="([^"]*\/threads\/[^"]*\.\d+[^"]*)"/g,

  // Thread ID from URL
  threadId: /\/threads\/[^.]*\.(\d+)/,

  // Preview tooltip URLs (XenForo 2.x)
  previewUrl: /data-preview-url="([^"]+)"/g,

  // Thread titles from structItem
  structItemTitle: /<div class="structItem-title">\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g,

  // Author from data attribute
  authorData: /data-user-id="(\d+)"[^>]*>([^<]+)</g,
};

/**
 * Extract threads from XenForo HTML using regex fallback
 */
export function extractXenforoThreads(html: string): Array<{ url: string; title: string; threadId: string }> {
  const threads: Array<{ url: string; title: string; threadId: string }> = [];
  const seen = new Set<string>();

  // Try structItem pattern first (XenForo 2.x)
  const structItemPattern = /<a[^>]*href="([^"]*\/threads\/[^"]*\.(\d+)[^"]*)"[^>]*class="[^"]*"[^>]*>([^<]+)<\/a>/g;
  let match;

  while ((match = structItemPattern.exec(html)) !== null) {
    const [, url, threadId, title] = match;
    if (!seen.has(threadId)) {
      seen.add(threadId);
      threads.push({
        url: url.replace(/&amp;/g, '&'),
        title: title.trim(),
        threadId,
      });
    }
  }

  // Try data-preview-url pattern
  if (threads.length === 0) {
    const previewPattern = /data-preview-url="[^"]*\/threads\/[^"]*\.(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g;
    while ((match = previewPattern.exec(html)) !== null) {
      const [fullMatch, threadId, title] = match;
      if (!seen.has(threadId)) {
        seen.add(threadId);
        // Extract URL from the anchor tag
        const urlMatch = fullMatch.match(/href="([^"]+)"/);
        if (urlMatch) {
          threads.push({
            url: urlMatch[1].replace(/&amp;/g, '&'),
            title: title.trim(),
            threadId,
          });
        }
      }
    }
  }

  // Fallback: any /threads/*.{id} URL
  if (threads.length === 0) {
    const fallbackPattern = /href="([^"]*\/threads\/([^"]*?)\.(\d+)[^"]*)"/g;
    while ((match = fallbackPattern.exec(html)) !== null) {
      const [, url, slug, threadId] = match;
      if (!seen.has(threadId) && !url.includes('/page-') && !url.includes('#')) {
        seen.add(threadId);
        threads.push({
          url: url.replace(/&amp;/g, '&'),
          title: slug.replace(/-/g, ' '),
          threadId,
        });
      }
    }
  }

  return threads;
}

export default xenforoSelectors;
