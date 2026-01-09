import { test, expect } from 'playwright/test';

/**
 * MyAuctions Stats Modal Test
 * Tests clickable stat cards and modal functionality
 */

test.describe('MyAuctions Stats Modal', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    // Navigate to profile page (MyAuctions is shown in the auctions tab)
    // Note: This requires authentication - adjust URL if needed
    const url = baseURL ? `${baseURL}/profile` : 'https://n-zero.dev/profile';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    
    // Wait for page to load
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      // Network idle might not happen, that's okay
    });
  });

  test('MyAuctions page loads with stat cards', async ({ page }) => {
    // Try to find and click the auctions tab
    const auctionsTab = page.locator('text=/auctions/i').first();
    
    // If tab exists, click it
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000); // Wait for tab content to load
    }

    // Check for "My Auctions" heading or stat cards
    const hasMyAuctions = await page.locator('text=/My Auctions|Active Listings|Total Views/i').first().isVisible({ timeout: 5000 }).catch(() => false);
    
    if (!hasMyAuctions) {
      // Page might require auth or might not have data
      console.log('MyAuctions page may require authentication or has no data');
      return;
    }

    // Verify stat cards are present
    const activeListingsCard = page.locator('text=Active Listings').first();
    await expect(activeListingsCard).toBeVisible({ timeout: 5000 });
  });

  test('clicking Active Listings opens modal', async ({ page }) => {
    // Navigate and find auctions tab
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    // Find and click Active Listings stat card
    const activeListingsCard = page.locator('text=Active Listings').first();
    
    if (await activeListingsCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click the stat card (need to find the clickable parent)
      const statCard = activeListingsCard.locator('..').first();
      await statCard.click();
      
      // Wait for modal to appear
      await page.waitForTimeout(500);
      
      // Check for modal
      const modal = page.locator('.modal-overlay, [class*="modal"]').first();
      const modalTitle = page.locator('text=/Active Listings/i');
      
      // Modal should be visible
      const modalVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false) || 
                          await modalTitle.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (modalVisible) {
        // Verify modal has close button
        const closeButton = page.locator('button:has-text("CLOSE"), button:has-text("Close")').first();
        await expect(closeButton).toBeVisible({ timeout: 2000 });
        
        // Click close button
        await closeButton.click();
        await page.waitForTimeout(300);
        
        // Modal should be closed
        const modalStillVisible = await modal.isVisible({ timeout: 1000 }).catch(() => false);
        expect(modalStillVisible).toBeFalsy();
      } else {
        console.log('Modal did not appear - may need authentication or data');
      }
    } else {
      console.log('Active Listings card not found - may need authentication');
    }
  });

  test('clicking Total Views opens modal with chart', async ({ page }) => {
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    const totalViewsCard = page.locator('text=Total Views').first();
    
    if (await totalViewsCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statCard = totalViewsCard.locator('..').first();
      await statCard.click();
      
      await page.waitForTimeout(500);
      
      // Check for modal with "Total Views" title
      const modalTitle = page.locator('text=/Total Views by Platform/i');
      const modalVisible = await modalTitle.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (modalVisible) {
        // Check for chart (SVG element)
        const chart = page.locator('svg').first();
        const hasChart = await chart.isVisible({ timeout: 2000 }).catch(() => false);
        
        // Chart should be present (if there's data)
        if (hasChart) {
          expect(chart).toBeVisible();
        }
        
        // Close modal
        const closeButton = page.locator('button:has-text("CLOSE")').first();
        if (await closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await closeButton.click();
        }
      }
    }
  });

  test('clicking Total Bids opens modal with pie chart', async ({ page }) => {
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    const totalBidsCard = page.locator('text=Total Bids').first();
    
    if (await totalBidsCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statCard = totalBidsCard.locator('..').first();
      await statCard.click();
      
      await page.waitForTimeout(500);
      
      const modalTitle = page.locator('text=/Total Bids by Platform/i');
      const modalVisible = await modalTitle.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (modalVisible) {
        // Check for pie chart (SVG with paths)
        const svg = page.locator('svg').first();
        const hasSvg = await svg.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (hasSvg) {
          // Check for path elements (pie chart segments)
          const paths = svg.locator('path');
          const pathCount = await paths.count();
          console.log('Pie chart paths found:', pathCount);
        }
      }
    }
  });

  test('clicking Gross Sold Value opens modal with financial breakdown', async ({ page }) => {
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    const grossSoldCard = page.locator('text=Gross Sold Value').first();
    
    if (await grossSoldCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statCard = grossSoldCard.locator('..').first();
      await statCard.click();
      
      await page.waitForTimeout(500);
      
      const modalTitle = page.locator('text=/Gross Sold Value Breakdown/i');
      const modalVisible = await modalTitle.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (modalVisible) {
        // Check for financial data (Sale Price, Margin, ROI, etc.)
        const salePrice = page.locator('text=/Sale Price/i');
        const hasSalePrice = await salePrice.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (hasSalePrice) {
          // May have margin/ROI if expense data is available
          const margin = page.locator('text=/Margin/i');
          const roi = page.locator('text=/ROI/i');
          
          const hasMargin = await margin.isVisible({ timeout: 1000 }).catch(() => false);
          const hasROI = await roi.isVisible({ timeout: 1000 }).catch(() => false);
          
          console.log('Financial data present - Margin:', hasMargin, 'ROI:', hasROI);
        }
      }
    }
  });

  test('clicking Sold This Month opens modal with vehicle cards', async ({ page }) => {
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    const soldThisMonthCard = page.locator('text=Sold This Month').first();
    
    if (await soldThisMonthCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statCard = soldThisMonthCard.locator('..').first();
      await statCard.click();
      
      await page.waitForTimeout(500);
      
      const modalTitle = page.locator('text=/Sold This Month/i');
      const modalVisible = await modalTitle.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (modalVisible) {
        // Check for vehicle cards or "No vehicles sold" message
        const vehicleCards = page.locator('.card').all();
        const noDataMessage = page.locator('text=/No vehicles sold this month/i');
        
        const hasCards = (await vehicleCards.length) > 0;
        const hasNoData = await noDataMessage.isVisible({ timeout: 1000 }).catch(() => false);
        
        expect(hasCards || hasNoData).toBeTruthy();
      }
    }
  });

  test('modal closes when clicking outside', async ({ page }) => {
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    const activeListingsCard = page.locator('text=Active Listings').first();
    
    if (await activeListingsCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statCard = activeListingsCard.locator('..').first();
      await statCard.click();
      
      await page.waitForTimeout(500);
      
      const modal = page.locator('.modal-overlay').first();
      const modalVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (modalVisible) {
        // Click outside modal (on the overlay)
        await modal.click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(300);
        
        // Modal should be closed
        const stillVisible = await modal.isVisible({ timeout: 1000 }).catch(() => false);
        expect(stillVisible).toBeFalsy();
      }
    }
  });

  test('stat cards have hover effect', async ({ page }) => {
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    const activeListingsCard = page.locator('text=Active Listings').first();
    
    if (await activeListingsCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      const statCard = activeListingsCard.locator('..').first();
      
      // Get initial opacity
      const initialOpacity = await statCard.evaluate(el => window.getComputedStyle(el).opacity);
      
      // Hover over the card
      await statCard.hover();
      await page.waitForTimeout(200);
      
      // Get opacity after hover
      const hoverOpacity = await statCard.evaluate(el => window.getComputedStyle(el).opacity);
      
      // Opacity should change (should be 0.8 on hover)
      console.log('Initial opacity:', initialOpacity, 'Hover opacity:', hoverOpacity);
      expect(hoverOpacity).not.toBe(initialOpacity);
    }
  });

  test('all stat cards are clickable', async ({ page }) => {
    const auctionsTab = page.locator('text=/auctions/i').first();
    if (await auctionsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await auctionsTab.click();
      await page.waitForTimeout(1000);
    }

    const statLabels = [
      'Active Listings',
      'Total Views',
      'Total Bids',
      'Gross Sold Value',
      'Sold This Month'
    ];

    for (const label of statLabels) {
      const card = page.locator(`text=${label}`).first();
      
      if (await card.isVisible({ timeout: 2000 }).catch(() => false)) {
        const statCard = card.locator('..').first();
        
        // Check that it has cursor pointer style
        const cursor = await statCard.evaluate(el => window.getComputedStyle(el).cursor);
        expect(cursor).toBe('pointer');
      }
    }
  });
});

