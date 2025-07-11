const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs').promises;

class ShopifyMonitor {
  constructor() {
    this.results = [];
    this.timestamp = new Date().toISOString().split('T')[0];
  }

  async run() {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    const page = await browser.newPage();
    
    // Set a realistic user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
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
      
      // Check for broken links (simplified)
      await this.checkBrokenLinks(page);
      
      // Report JavaScript errors (limit to reduce noise)
      if (errors.length > 0) {
        const errorCount = errors.length;
        const sampleErrors = errors.slice(0, 2).join(', '); // Show first 2 errors
        this.addResult('JavaScript Errors', 'WARN', `Found ${errorCount} errors. Sample: ${sampleErrors}`);
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
      console.log('Checking homepage...');
      
      // Use 'domcontentloaded' instead of 'networkidle' - much more reliable
      const response = await page.goto('https://lolovivijewelry.com', { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      
      if (!response) {
        this.addResult('Homepage Load', 'FAIL', 'No response received');
        return;
      }

      if (response.status() !== 200) {
        this.addResult('Homepage Load', 'FAIL', `HTTP ${response.status()}`);
        return;
      }

      // Check if page loaded successfully
      const title = await page.title();
      if (title.includes('404') || title.includes('Error') || title.includes('Not Found')) {
        this.addResult('Homepage Load', 'FAIL', `Page title suggests error: ${title}`);
        return;
      }

      this.addResult('Homepage Load', 'PASS', `Loaded successfully (${response.status()}) - ${title}`);

      // Wait a bit for page to settle
      await page.waitForTimeout(2000);

      // Check main navigation elements (more flexible selectors)
      const navChecks = [
        { selector: 'nav, .nav, .navigation, header nav, .site-nav', name: 'Main Navigation' },
        { selector: 'a[href*="collections"], a[href*="catalog"], a[href*="shop"]', name: 'Shop/Collections Link' },
        { selector: '.cart, [href*="cart"], .cart-link, .bag', name: 'Cart Link' },
        { selector: 'input[type="search"], .search, [placeholder*="search"]', name: 'Search Function' },
      ];

      for (const check of navChecks) {
        try {
          const element = await page.$(check.selector);
          if (element) {
            this.addResult(check.name, 'PASS', 'Element found and accessible');
          } else {
            this.addResult(check.name, 'WARN', `Element not found with selector: ${check.selector}`);
          }
        } catch (error) {
          this.addResult(check.name, 'WARN', `Error checking element: ${error.message}`);
        }
      }

    } catch (error) {
      this.addResult('Homepage Load', 'FAIL', `Error loading homepage: ${error.message}`);
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
        console.log(`Checking ${pageCheck.name}...`);
        
        const response = await page.goto(`https://lolovivijewelry.com${pageCheck.url}`, {
          waitUntil: 'domcontentloaded', // Changed from 'networkidle'
          timeout: 10000
        });

        if (!response) {
          this.addResult(pageCheck.name, 'FAIL', 'No response received');
          continue;
        }

        if (response.status() === 200) {
          // Wait a moment for content to load
          await page.waitForTimeout(1000);
          
          // Check for common error indicators
          const title = await page.title();
          if (title.includes('404') || title.includes('Not Found') || title.includes('Error')) {
            this.addResult(pageCheck.name, 'FAIL', `404 error detected in title: ${title}`);
          } else {
            this.addResult(pageCheck.name, 'PASS', `Loaded successfully (${response.status()}) - ${title.substring(0, 50)}...`);
          }
        } else if (response.status() === 404) {
          this.addResult(pageCheck.name, 'WARN', `Page not found (404) - may not exist yet`);
        } else {
          this.addResult(pageCheck.name, 'FAIL', `HTTP ${response.status()}`);
        }
      } catch (error) {
        if (error.message.includes('timeout')) {
          this.addResult(pageCheck.name, 'WARN', `Page loading slowly (timeout) - may need optimization`);
        } else {
          this.addResult(pageCheck.name, 'FAIL', `Failed to load: ${error.message}`);
        }
      }
    }
  }

  async checkBrokenLinks(page) {
    try {
      console.log('Checking for broken links...');
      
      // Go back to homepage for link checking
      await page.goto('https://lolovivijewelry.com', { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });
      
      await page.waitForTimeout(2000);
      
      // Get internal links only (more reliable)
      const links = await page.$$eval('a[href]', anchors => 
        anchors.map(a => a.href)
          .filter(href => 
            href && 
            !href.includes('mailto:') && 
            !href.includes('tel:') &&
            !href.includes('javascript:') &&
            (href.includes('lolovivijewelry.com') || href.startsWith('/'))
          )
          .slice(0, 5) // Test only first 5 links to avoid timeouts
      );

      if (links.length === 0) {
        this.addResult('Link Check', 'WARN', 'No internal links found to test');
        return;
      }

      let brokenCount = 0;
      for (const link of links) {
        try {
          const response = await page.goto(link, { 
            waitUntil: 'domcontentloaded',
            timeout: 8000 
          });
          if (response && response.status() >= 400) {
            brokenCount++;
          }
        } catch (error) {
          brokenCount++;
        }
      }

      if (brokenCount > 0) {
        this.addResult('Link Check', 'WARN', `Found ${brokenCount} problematic links out of ${links.length} checked`);
      } else {
        this.addResult('Link Check', 'PASS', `All ${links.length} tested links working properly`);
      }

    } catch (error) {
      this.addResult('Link Check', 'WARN', `Error checking links: ${error.message}`);
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
      console.log('Uploading results to Google Sheets...');
      
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

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Sheet1!A:E',
        valueInputOption: 'RAW',
        requestBody: {
          values: values
        }
      });

      console.log('Results uploaded to Google Sheets successfully!');
    } catch (error) {
      console.error('Failed to upload to Google Sheets:', error.message);
      console.error('Error details:', error);
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
