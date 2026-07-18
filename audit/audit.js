// Full audit sweep of clockwork9.com — "before" evidence for a rebuild case study.
// Loads each URL from the inventory sequentially (bot-throttle-safe), captures SEO
// surface, runs axe-core, collects internal links, and screenshots representative pages.
// Then does a second pass link-check on discovered internal URLs not in the inventory.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { parseInventory } = require('./parse-inventory');

const EVIDENCE_DIR = '/Users/giantrotta/Code/clockwork9-rebuild/docs/evidence/baseline-2026-07-18';
const INVENTORY_PATH = path.join(EVIDENCE_DIR, 'url-inventory.md');
const SCREENSHOTS_DIR = path.join(EVIDENCE_DIR, 'screenshots');
const RESULTS_PATH = path.join(EVIDENCE_DIR, 'audit-results.json');
const AXE_PATH = path.join(__dirname, 'node_modules', 'axe-core', 'axe.min.js');

const NO_SCREENSHOT_GROUPS = new Set([
  'Blog tags (post_tag-sitemap.xml) — thin archives',
  'Blog authors (author-sitemap.xml)',
]);

const PAGE_TIMEOUT = 45000;
const RETRY_DELAY_MS = 20000;
const BETWEEN_PAGE_DELAY_MS = 2500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(url) {
  const u = new URL(url);
  let p = u.pathname;
  if (p === '/' || p === '') return 'home';
  p = p.replace(/^\/|\/$/g, ''); // trim leading/trailing slash
  return p.replace(/\//g, '-');
}

async function loadWithRetry(page, url) {
  const attempt = async () => {
    let status = null;
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT }).catch(async (err) => {
      // fallback to 'load'
      return page.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT });
    });
    status = response ? response.status() : null;
    return { status, finalUrl: page.url() };
  };

  try {
    return await attempt();
  } catch (err) {
    console.log(`  [retry] ${url} failed once (${err.message.split('\n')[0]}), waiting ${RETRY_DELAY_MS}ms then retrying...`);
    await sleep(RETRY_DELAY_MS);
    try {
      return await attempt();
    } catch (err2) {
      return { status: null, finalUrl: url, error: err2.message.split('\n')[0] };
    }
  }
}

async function extractSeo(page) {
  return page.evaluate(() => {
    const getMeta = (selector, attr = 'content') => {
      const el = document.querySelector(selector);
      return el ? el.getAttribute(attr) : null;
    };
    const h1s = Array.from(document.querySelectorAll('h1'));
    return {
      title: document.title || null,
      metaDescription: getMeta('meta[name="description"]'),
      canonical: getMeta('link[rel="canonical"]', 'href'),
      ogTitlePresent: !!document.querySelector('meta[property="og:title"]'),
      ogImagePresent: !!document.querySelector('meta[property="og:image"]'),
      h1Text: h1s.length > 0 ? h1s[0].textContent.trim() : null,
      h1Count: h1s.length,
      robotsMeta: getMeta('meta[name="robots"]'),
    };
  });
}

async function extractInternalLinks(page, baseHost) {
  return page.evaluate((baseHost) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const hrefs = anchors.map((a) => a.getAttribute('href')).filter(Boolean);
    const internal = new Set();
    for (const href of hrefs) {
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
      try {
        const resolved = new URL(href, window.location.href);
        if (resolved.hostname === baseHost || resolved.hostname === `www.${baseHost}`) {
          internal.add(resolved.href);
        }
      } catch (e) {
        // ignore malformed hrefs
      }
    }
    return Array.from(internal);
  }, baseHost);
}

async function runAxe(page) {
  try {
    const axeSource = fs.readFileSync(AXE_PATH, 'utf8');
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run();
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        nodes: v.nodes.length,
      }));
    });
    return results;
  } catch (err) {
    return { error: err.message.split('\n')[0] };
  }
}

async function main() {
  const groups = parseInventory(INVENTORY_PATH);
  const allEntries = [];
  for (const [group, urls] of Object.entries(groups)) {
    for (const url of urls) {
      allEntries.push({ group, url });
    }
  }

  let entriesToRun = allEntries;
  if (process.env.AUDIT_LIMIT) {
    entriesToRun = allEntries.slice(0, parseInt(process.env.AUDIT_LIMIT, 10));
  }

  console.log(`Loaded ${allEntries.length} URLs across ${Object.keys(groups).length} groups. Running ${entriesToRun.length}.`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const results = [];
  const allInternalLinks = new Map(); // url -> Set of referring pages

  for (let i = 0; i < entriesToRun.length; i++) {
    const { group, url } = entriesToRun[i];
    console.log(`[${i + 1}/${entriesToRun.length}] ${url}`);

    const { status, finalUrl, error } = await loadWithRetry(page, url);

    const record = {
      group,
      requestedUrl: url,
      finalUrl,
      status,
      loadError: error || null,
    };

    if (status !== null) {
      try {
        record.seo = await extractSeo(page);
      } catch (err) {
        record.seo = { error: err.message.split('\n')[0] };
      }

      try {
        record.axeViolations = await runAxe(page);
      } catch (err) {
        record.axeViolations = { error: err.message.split('\n')[0] };
      }

      try {
        const links = await extractInternalLinks(page, 'clockwork9.com');
        record.internalLinks = links;
        for (const link of links) {
          if (!allInternalLinks.has(link)) allInternalLinks.set(link, new Set());
          allInternalLinks.get(link).add(url);
        }
      } catch (err) {
        record.internalLinks = [];
        record.linkExtractError = err.message.split('\n')[0];
      }

      if (!NO_SCREENSHOT_GROUPS.has(group)) {
        const slug = slugify(url);
        const screenshotPath = path.join(SCREENSHOTS_DIR, `${slug}.png`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          record.screenshot = path.relative(EVIDENCE_DIR, screenshotPath);
        } catch (err) {
          record.screenshotError = err.message.split('\n')[0];
        }
      }
    } else {
      record.seo = null;
      record.axeViolations = null;
      record.internalLinks = [];
    }

    results.push(record);
    await sleep(BETWEEN_PAGE_DELAY_MS);
  }

  // Special extra screenshots: homepage mobile, work/nike mobile
  console.log('Capturing mobile screenshots...');
  const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mobilePage = await mobileContext.newPage();

  try {
    await loadWithRetry(mobilePage, 'https://clockwork9.com/');
    await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, 'home--mobile.png'), fullPage: true });
    console.log('  saved home--mobile.png');
  } catch (err) {
    console.log(`  failed home--mobile.png: ${err.message.split('\n')[0]}`);
  }
  await sleep(BETWEEN_PAGE_DELAY_MS);

  try {
    await loadWithRetry(mobilePage, 'https://clockwork9.com/work/nike/');
    await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, 'work-nike--mobile.png'), fullPage: true });
    console.log('  saved work-nike--mobile.png');
  } catch (err) {
    console.log(`  failed work-nike--mobile.png: ${err.message.split('\n')[0]}`);
  }

  await mobileContext.close();

  // Second pass: link check on internal links NOT in the inventory
  console.log('Starting link check pass...');
  const inventoryUrlSet = new Set(allEntries.map((e) => normalizeUrl(e.url)));
  const candidateLinks = [];
  for (const [link, referrers] of allInternalLinks.entries()) {
    if (!inventoryUrlSet.has(normalizeUrl(link))) {
      candidateLinks.push({ url: link, referrers: Array.from(referrers) });
    }
  }
  console.log(`Found ${candidateLinks.length} internal links outside the inventory to check.`);

  const linkcheck = [];
  const linkCheckPage = await context.newPage();
  for (let i = 0; i < candidateLinks.length; i++) {
    const { url, referrers } = candidateLinks[i];
    console.log(`[linkcheck ${i + 1}/${candidateLinks.length}] ${url}`);
    let status = null;
    let errorMsg = null;
    try {
      const response = await linkCheckPage.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT });
      status = response ? response.status() : null;
    } catch (err) {
      errorMsg = err.message.split('\n')[0];
    }
    linkcheck.push({ url, status, error: errorMsg, referringPages: referrers });
    await sleep(1500);
  }

  await browser.close();

  const output = {
    capturedAt: new Date().toISOString(),
    totalUrls: allEntries.length,
    pages: results,
    linkcheck,
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2));
  console.log(`Saved results to ${RESULTS_PATH}`);
}

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    let p = url.pathname;
    if (!p.endsWith('/') && !p.includes('.')) p += '/';
    return `${url.hostname}${p}${url.search}`.replace(/^www\./, '');
  } catch (e) {
    return u;
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
