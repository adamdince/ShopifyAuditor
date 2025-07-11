const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs').promises;

class ShopifyMonitor {
  constructor() {
    this.results = [];
    this.timestamp = new Date().toISOString().split('T')[0];
  }

  async run() {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    try {
      console.log('Starting Shopify store monitoring...');
      
      // Track console errors
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });

      // Check main navigation
      await this.checkMainNavigation(page);
      
      // Check key pages
      await this.checkKeyPages(page);
      
      // Check for broken links
      await this.checkBrokenLinks(page);
      
      // Report JavaScript errors
      if (errors.length > 0) {
        this.addResult('JavaScript Errors', 'FAIL', `Found ${errors.length} errors: ${errors.slice(0, 3).join(', ')}`);
      } else {
        this.addResult('JavaScript Errors', 'PASS', 'No JavaScript errors detected');
      }
      
    } catch (error) {
      console.error('Monitoring failed:', error);
      this.addResult('Monitor Execution', 'FAIL', `Monitoring script failed: ${error.message}`);
    } finally {
      await browser.close();
    }

    // Save results and upload to Google Sheets
    await this.saveResults();
    await this.uploadToGoogleSheets();
  }

  async checkMainNavigation(page) {
    try {
      // Navigate to your store
      await page.goto('https://lolovivijewelry.com', { waitUntil: 'networkidle' });
      
      // Check if page loaded successfully
      const title = await page.title();
      if (title.includes('404') || title.includes('Error')) {
        this.addResult('Homepage Load', 'FAIL', `Page title suggests error: ${title}`);
        return;
      }

      // Check main navigation elements
      const navChecks = [
        { selector: 'header nav', name: 'Main Navigation' },
        { selector: '[href*="collections"]', name: 'Collections Link' },
        { selector: '.cart-link, [href*="cart"]', name: 'Cart Link' },
        { selector: '.search, [type="search"]', name: 'Search Function' },
      ];

      for (const check of navChecks) {
        const element = await page.$(check.selector);
        if (element) {
          this.addResult(check.name, 'PASS', 'Element found and accessible');
        } else {
          this.addResult(check.name, 'FAIL', `Element not found: ${check.selector}`);
        }
      }

    } catch (error) {
      this.addResult('Navigation Check', 'FAIL', `Error checking navigation: ${error.message}`);
    }
  }

  async checkKeyPages(page) {
    // Key pages to check for your Shopify store
    const pagesToCheck = [
      { url: '/collections', name: 'Collections Page' },
      { url: '/pages/about', name: 'About Page' },
      { url: '/pages/contact', name: 'Contact Page' },
      { url: '/cart', name: 'Cart Page' },
      { url: '/account/login', name: 'Login Page' }
    ];

    for (const pageCheck of pagesToCheck) {
      try {
        const response = await page.goto(`https://lolovivijewelry.com${pageCheck.url}`, {
          waitUntil: 'networkidle',
          timeout: 10000
        });

        if (response.status() === 200) {
          // Check for common error indicators
          const content = await page.content();
          if (content.includes('404') || content.includes('Page not found')) {
            this.addResult(pageCheck.name, 'FAIL', '404 error detected');
          } else {
            this.addResult(pageCheck.name, 'PASS', `Loaded successfully (${response.status()})`);
          }
        } else {
          this.addResult(pageCheck.name, 'FAIL', `HTTP ${response.status()}`);
        }
      } catch (error) {
        this.addResult(pageCheck.name, 'FAIL', `Failed to load: ${error.message}`);
      }
    }
  }

  async checkBrokenLinks(page) {
    try {
      await page.goto('https://lolovivijewelry.com');
      
      // Get all links on the homepage
      const links = await page.$$eval('a[href]', anchors => 
        anchors.map(a => a.href).filter(href => 
          href.startsWith('http') && !href.includes('mailto:') && !href.includes('tel:')
        ).slice(0, 10) // Limit to first 10 links to avoid timeout
      );

      let brokenCount = 0;
      for (const link of links) {
        try {
          const response = await page.goto(link, { timeout: 5000 });
          if (response.status() >= 400) {
            brokenCount++;
          }
        } catch (error) {
          brokenCount++;
        }
      }

      if (brokenCount > 0) {
        this.addResult('Broken Links', 'FAIL', `Found ${brokenCount} broken links out of ${links.length} checked`);
      } else {
        this.addResult('Broken Links', 'PASS', `All ${links.length} links working properly`);
      }

    } catch (error) {
      this.addResult('Link Check', 'FAIL', `Error checking links: ${error.message}`);
    }
  }

  addResult(test, status, details) {
    this.results.push({
      date: this.timestamp,
      test,
      status,
      details,
      timestamp: new Date().toISOString()
    });
    console.log(`${status}: ${test} - ${details}`);
  }

  async saveResults() {
    const filename = `results-${this.timestamp}.json`;
    await fs.writeFile(filename, JSON.stringify(this.results, null, 2));
    console.log(`Results saved to ${filename}`);
  }

  async uploadToGoogleSheets() {
    try {
      // Create service account credentials from environment variable
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;

      // Prepare data for sheets
      const values = this.results.map(result => [
        result.date,
        result.test,
        result.status,
        result.details,
        result.timestamp
      ]);

      // Add header if sheet is empty
      const headers = [['Date', 'Test', 'Status', 'Details', 'Timestamp']];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Sheet1!A:E',
        valueInputOption: 'RAW',
        requestBody: {
          values: [...headers, ...values]
        }
      });

      console.log('Results uploaded to Google Sheets');
    } catch (error) {
      console.error('Failed to upload to Google Sheets:', error.message);
    }
  }
}

// Run the monitor
async function main() {
  const monitor = new ShopifyMonitor();
  await monitor.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ShopifyMonitor;
