/**
 * Impatient Ian - Rapid clicks, doesn't wait, stress tests UI
 * Tests: Debouncing, loading states, race conditions, UI blocking
 */

import { BotRunner } from '../BotRunner';
import type { BotPersona } from '../types';

export class ImpatientUserBot extends BotRunner {
  constructor(persona: BotPersona) {
    super(persona, {
      timeout: 5000, // Very short timeout
      slowMo: 0, // No artificial slowdown
    });
  }

  /**
   * Execute impatient user behavior
   */
  async execute(): Promise<void> {
    await this.start();
    const page = this.getPage();
    if (!page) return;

    // 1. Rapid navigation - click before page loads
    await this.rapidNavigation();

    // 2. Double/triple click buttons
    await this.multipleClicks();

    // 3. Rapid filter changes
    await this.rapidFilterChanges();

    // 4. Spam refresh
    await this.spamRefresh();

    // 5. Click while loading
    await this.clickDuringLoad();

    await this.complete();
  }

  private async rapidNavigation(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Start multiple navigations in quick succession
    const pages = ['/', '/vehicles', '/about'];
    
    for (const path of pages) {
      // Don't wait for previous navigation to complete
      page.goto(`${page.url().split('/').slice(0, 3).join('/')}${path}`, { 
        waitUntil: 'commit',
        timeout: 3000,
      }).catch(() => {
        // Expected - we're interrupting navigations
      });
      
      // Only wait a tiny bit before next navigation
      await this.sleep(200);
    }

    // Now actually wait for the page to settle
    await this.sleep(2000);
    
    // Check if we ended up somewhere valid
    const title = await page.title();
    if (title) {
      this.log('rapid_nav', 'success', `Page settled on: ${title}`);
    } else {
      await this.reportFinding(
        'bug',
        'medium',
        'Page in invalid state after rapid navigation',
        'Rapid navigation left page without a title'
      );
    }
  }

  private async multipleClicks(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    await this.navigate('/vehicles');
    await this.sleep(1000);

    // Find any clickable button
    const buttonSelectors = [
      'button:visible',
      '[role="button"]:visible',
      'a[href]:visible',
    ];

    for (const selector of buttonSelectors) {
      try {
        const buttons = await page.$$(selector);
        if (buttons.length > 0) {
          const button = buttons[0];
          
          // Triple click rapidly
          for (let i = 0; i < 3; i++) {
            button.click().catch(() => {});
          }
          
          await this.sleep(500);
          
          // Check for duplicate actions or errors
          const errorVisible = await page.$('[class*="error"]') || 
                               await page.$('[role="alert"]');
          
          if (errorVisible) {
            await this.reportFinding(
              'bug',
              'medium',
              'Multiple rapid clicks caused an error',
              'Button did not properly debounce clicks'
            );
          } else {
            this.log('multi_click', 'success', 'Button handled multiple clicks');
          }
          break;
        }
      } catch {
        // Try next selector
      }
    }
  }

  private async rapidFilterChanges(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    await this.navigate('/vehicles');
    await this.sleep(1000);

    // Find filter inputs
    const filterInputs = await page.$$('select, input[type="text"], input[type="search"]');
    
    if (filterInputs.length > 0) {
      const input = filterInputs[0];
      const tagName = await input.evaluate(el => el.tagName);
      
      if (tagName === 'SELECT') {
        // Rapidly change select options
        const options = await input.$$('option');
        for (let i = 0; i < Math.min(options.length, 5); i++) {
          try {
            await input.selectOption({ index: i });
            // Don't wait - immediately select next
          } catch {
            // Selection might fail mid-change
          }
        }
      } else {
        // Rapidly type different searches
        const searches = ['Ford', 'Chevy', 'Dodge', 'BMW'];
        for (const search of searches) {
          await input.fill(search);
          // Don't wait for results
        }
      }
      
      await this.sleep(2000);
      
      // Check if page is in a valid state
      const pageErrored = await page.$('[class*="error"]');
      if (pageErrored) {
        await this.reportFinding(
          'bug',
          'high',
          'Rapid filter changes caused error state',
          'Filters do not properly debounce or cancel previous requests'
        );
      } else {
        this.log('rapid_filter', 'success', 'Filters handled rapid changes');
      }
    }
  }

  private async spamRefresh(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Refresh 3 times rapidly
    for (let i = 0; i < 3; i++) {
      page.reload({ waitUntil: 'commit', timeout: 2000 }).catch(() => {});
      await this.sleep(100);
    }

    // Wait for page to settle
    await this.sleep(3000);

    // Check page state
    const bodyExists = await page.$('body');
    if (!bodyExists) {
      await this.reportFinding(
        'bug',
        'critical',
        'Page blank after rapid refresh',
        'Multiple rapid refreshes left page in broken state'
      );
    } else {
      this.log('spam_refresh', 'success', 'Page recovered from rapid refreshes');
    }
  }

  private async clickDuringLoad(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Start navigation
    const navPromise = page.goto('/vehicles', { waitUntil: 'domcontentloaded' });
    
    // Immediately start clicking
    await this.sleep(100);
    
    // Click everywhere while loading
    const clickPromises = [];
    for (let i = 0; i < 5; i++) {
      clickPromises.push(
        page.click('body', { force: true, timeout: 500 }).catch(() => {})
      );
      await this.sleep(50);
    }

    // Wait for navigation to complete
    try {
      await navPromise;
      await Promise.all(clickPromises);
      this.log('click_during_load', 'success', 'Page handled clicks during load');
    } catch (error) {
      await this.reportFinding(
        'bug',
        'medium',
        'Page unstable when clicking during load',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
