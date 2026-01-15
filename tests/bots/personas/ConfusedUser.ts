/**
 * Confused Carl - New user who doesn't understand the UI
 * Tests: Error messages, dead ends, navigation clarity, help text
 */

import { BotRunner } from '../BotRunner';
import type { BotPersona } from '../types';

export class ConfusedUserBot extends BotRunner {
  constructor(persona: BotPersona) {
    super(persona, {
      timeout: 20000, // Patient but confused
      slowMo: 200, // Slow, deliberate actions
    });
  }

  /**
   * Execute confused user behavior
   */
  async execute(): Promise<void> {
    await this.start();
    const page = this.getPage();
    if (!page) return;

    // 1. Try to find things that don't exist
    await this.searchForNonexistent();

    // 2. Navigate to random pages and try to go back
    await this.getLostandGoBack();

    // 3. Click on disabled/inactive elements
    await this.clickDisabledElements();

    // 4. Try submitting empty forms
    await this.submitEmptyForms();

    // 5. Look for help/support
    await this.lookForHelp();

    // 6. Check for clear error messages
    await this.triggerErrors();

    await this.complete();
  }

  private async searchForNonexistent(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    await this.navigate('/vehicles');
    await this.sleep(1500);

    // Search for something that definitely won't exist
    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
    ];

    for (const selector of searchSelectors) {
      try {
        const searchBox = await page.$(selector);
        if (searchBox) {
          // Search for gibberish
          await this.type(selector, 'xyznonexistent12345', 'Search for non-existent item');
          await page.keyboard.press('Enter');
          await this.sleep(2000);

          // Check for helpful "no results" message
          const noResultsIndicators = [
            'text=No results',
            'text=Nothing found',
            'text=no vehicles',
            '[class*="empty"]',
            '[class*="no-results"]',
          ];

          let foundHelpfulMessage = false;
          for (const indicator of noResultsIndicators) {
            const element = await page.$(indicator);
            if (element) {
              foundHelpfulMessage = true;
              this.log('no_results', 'success', 'Clear "no results" message shown');
              break;
            }
          }

          if (!foundHelpfulMessage) {
            // Check if page is just blank/confusing
            const visibleContent = await page.$$('main *:visible');
            if (visibleContent.length < 5) {
              await this.reportFinding(
                'ux_friction',
                'medium',
                'No clear message when search returns no results',
                'User searching for non-existent item sees blank/confusing page'
              );
            }
          }
          break;
        }
      } catch {
        // Try next selector
      }
    }
  }

  private async getLostandGoBack(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Navigate deep into the site
    await this.navigate('/vehicles');
    await this.sleep(1000);

    // Try to click on a vehicle
    const vehicleLink = await page.$('a[href*="/vehicle/"]');
    if (vehicleLink) {
      await vehicleLink.click();
      await this.sleep(2000);
    }

    // Now try to get back - a confused user might not use browser back
    const backLinks = [
      'a:has-text("Back")',
      'button:has-text("Back")',
      '[aria-label="Back"]',
      'a:has-text("← ")',
      '[class*="back"]',
    ];

    let foundBackButton = false;
    for (const selector of backLinks) {
      const backButton = await page.$(selector);
      if (backButton) {
        foundBackButton = true;
        this.log('navigation', 'success', 'Back button/link available');
        break;
      }
    }

    if (!foundBackButton) {
      // Check for breadcrumbs
      const breadcrumb = await page.$('[class*="breadcrumb"], nav[aria-label="breadcrumb"]');
      if (breadcrumb) {
        this.log('navigation', 'success', 'Breadcrumbs available for navigation');
      } else {
        await this.reportFinding(
          'ux_friction',
          'low',
          'No obvious way to navigate back',
          'Vehicle detail page lacks back button or breadcrumbs'
        );
      }
    }

    // Use browser back
    await page.goBack();
    await this.sleep(1000);
  }

  private async clickDisabledElements(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    await this.navigate('/');
    await this.sleep(1000);

    // Find disabled buttons
    const disabledButtons = await page.$$('button[disabled], button[aria-disabled="true"], .disabled');
    
    if (disabledButtons.length > 0) {
      for (const button of disabledButtons.slice(0, 2)) {
        try {
          // Try to click it
          await button.click({ force: true, timeout: 1000 });
          
          // Check if any feedback is given
          const tooltip = await page.$('[role="tooltip"]');
          const errorMessage = await page.$('[role="alert"]');
          
          if (!tooltip && !errorMessage) {
            // Check if button has title attribute for explanation
            const hasTitle = await button.getAttribute('title');
            if (!hasTitle) {
              await this.reportFinding(
                'ux_friction',
                'low',
                'Disabled button provides no explanation',
                'User clicking disabled button gets no feedback about why it is disabled'
              );
            }
          }
        } catch {
          // Expected - button is disabled
        }
      }
    }
  }

  private async submitEmptyForms(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Look for any forms on the page
    const forms = await page.$$('form');
    
    for (const form of forms.slice(0, 1)) { // Only test first form
      try {
        // Find submit button within form
        const submitButton = await form.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
        
        if (submitButton) {
          await submitButton.click();
          await this.sleep(1000);

          // Check for validation messages
          const validationMessages = await page.$$('[class*="error"], [class*="invalid"], [role="alert"]');
          
          if (validationMessages.length > 0) {
            this.log('validation', 'success', 'Form shows validation errors for empty submission');
          } else {
            // Check if form actually submitted (bad)
            const url = page.url();
            if (url.includes('success') || url.includes('thank')) {
              await this.reportFinding(
                'bug',
                'high',
                'Form submitted without required fields',
                'Empty form was accepted - missing client-side validation'
              );
            }
          }
        }
      } catch {
        // Form interaction failed
      }
    }
  }

  private async lookForHelp(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    await this.navigate('/');
    await this.sleep(1000);

    // Look for help/support links
    const helpIndicators = [
      'a:has-text("Help")',
      'a:has-text("Support")',
      'a:has-text("FAQ")',
      'a:has-text("Contact")',
      '[aria-label*="help"]',
      '[aria-label*="Help"]',
      'button:has-text("?")',
    ];

    let foundHelp = false;
    for (const selector of helpIndicators) {
      const helpElement = await page.$(selector);
      if (helpElement) {
        foundHelp = true;
        this.log('help', 'success', `Help available: ${selector}`);
        break;
      }
    }

    if (!foundHelp) {
      await this.reportFinding(
        'ux_friction',
        'low',
        'No obvious help/support option visible',
        'Confused users may struggle to find assistance'
      );
    }
  }

  private async triggerErrors(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Try to visit a page that doesn't exist
    await this.navigate('/this-page-definitely-does-not-exist-12345');
    await this.sleep(1500);

    // Check for proper 404 page
    const pageContent = await page.content();
    const has404Message = 
      pageContent.includes('404') ||
      pageContent.includes('not found') ||
      pageContent.includes('Not Found') ||
      pageContent.includes("doesn't exist");

    if (has404Message) {
      // Check if there's a way to get back to safety
      const homeLink = await page.$('a[href="/"], a:has-text("Home"), a:has-text("home")');
      if (homeLink) {
        this.log('404', 'success', '404 page has link back to home');
      } else {
        await this.reportFinding(
          'ux_friction',
          'medium',
          '404 page lacks navigation back to home',
          'User who hits 404 has no clear path back'
        );
      }
    } else {
      await this.reportFinding(
        'bug',
        'medium',
        'Invalid URL does not show proper 404 page',
        'Non-existent page may show broken content or blank page'
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
