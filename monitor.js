# Shopify Site Monitor

A free site monitoring tool using GitHub Actions, Playwright, and Google Sheets.

## Setup Instructions

### 1. Create a new GitHub repository
```bash
mkdir shopify-monitor
cd shopify-monitor
git init
```

### 2. Add these files to your repository:

## package.json
```json
{
  "name": "shopify-site-monitor",
  "version": "1.0.0",
  "description": "Daily site monitoring for Shopify store",
  "scripts": {
    "test": "playwright test",
    "monitor": "node monitor.js"
  },
  "dependencies": {
    "@playwright/test": "^1.40.0",
    "googleapis": "^126.0.1",
    "node-fetch": "^3.3.2"
  }
}
```

## monitor.js
```javascript
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
      // Replace with your Shopify store URL
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
      const links = await page.$eval('a[href]', anchors => 
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
```

## .github/workflows/monitor.yml
```yaml
name: Daily Shopify Store Monitor

on:
  schedule:
    # Run every day at 9 AM UTC (adjust timezone as needed)
    - cron: '0 9 * * *'
  workflow_dispatch: # Allows manual triggering

jobs:
  monitor:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
        
    - name: Install dependencies
      run: |
        npm install
        npx playwright install chromium
        
    - name: Run site monitor
      env:
        GOOGLE_CREDENTIALS: ${{ secrets.GOOGLE_CREDENTIALS }}
        GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
      run: npm run monitor
      
    - name: Upload results artifact
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: monitoring-results-${{ github.run_number }}
        path: results-*.json
```

## playwright.config.js
```javascript
module.exports = {
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 0,
    ignoreHTTPSErrors: true,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...require('@playwright/test').devices['Desktop Chrome'] },
    },
  ],
};
```

## Setup Instructions

### 3. Google Sheets Setup

1. **Create a Google Sheet:**
   - Go to sheets.google.com
   - Create a new sheet
   - Add headers in row 1: Date | Test | Status | Details | Timestamp
   - Copy the sheet ID from the URL (the long string between /spreadsheets/d/ and /edit)

2. **Create Google Service Account:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable the Google Sheets API
   - Go to "Credentials" → "Create Credentials" → "Service Account"
   - Download the JSON key file
   - Share your Google Sheet with the service account email (found in the JSON)

### 4. GitHub Repository Setup

1. **Add secrets to your GitHub repository:**
   - Go to your repo → Settings → Secrets and variables → Actions
   - Add these secrets:
     - `GOOGLE_CREDENTIALS`: Copy the entire contents of your service account JSON file
     - `GOOGLE_SHEET_ID`: Your Google Sheet ID from step 3

2. **Update the store URL:**
   - Edit `monitor.js` and replace `https://lolovivijewelry.com` with your actual Shopify store URL

3. **Customize the monitoring:**
   - Modify the `pagesToCheck` array to include your specific pages
   - Adjust the `navChecks` selectors to match your theme
   - Add store-specific checks (product pages, checkout flow, etc.)

### 5. Deploy and Test

```bash
# Commit all files to your repo
git add .
git commit -m "Add Shopify monitoring setup"
git push origin main

# Test manually first
# Go to Actions tab → Daily Shopify Store Monitor → Run workflow
```

### 6. Customize for Your Store

Update these sections in `monitor.js`:

```javascript
// Replace with your actual store URL
const STORE_URL = 'https://lolovivijewelry.com';

// Add your specific pages to monitor
const pagesToCheck = [
  { url: '/collections/featured', name: 'Featured Collection' },
  { url: '/products/your-bestseller', name: 'Bestseller Product' },
  { url: '/pages/shipping-info', name: 'Shipping Info' },
  // Add your important pages here
];

// Customize navigation checks for your theme
const navChecks = [
  { selector: '.site-nav', name: 'Main Navigation' },
  { selector: '.cart-link', name: 'Cart Icon' },
  { selector: '#search-form', name: 'Search Bar' },
  // Adjust selectors for your theme
];
```

## What This Monitors

✅ **Homepage loading and basic functionality**  
✅ **Main navigation elements**  
✅ **Key pages (collections, about, contact, cart, login)**  
✅ **Broken links detection**  
✅ **JavaScript errors**  
✅ **Daily automated reports to Google Sheets**

## Results in Google Sheets

Your sheet will show:
- Date of each check
- Test name (e.g., "Homepage Load", "Cart Link")
- Status (PASS/FAIL)
- Details about any issues found
- Exact timestamp

This runs completely free on GitHub Actions every day and gives you a historical record of your store's health!
