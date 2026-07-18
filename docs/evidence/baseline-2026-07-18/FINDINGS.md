# Clockwork9 Audit — Claim → Evidence Index

Captured 2026-07-18. Every claim made in the proposal maps to evidence in this
directory, with steps to re-verify live. Re-run the reproduce step shortly
before pitching — site state can change.

Server quirk: clockwork9.com hangs requests with non-browser user agents and
rate-limits rapid hits. All reproduce commands need a real Chrome UA string
and patience between requests.

---

## 1. `/work` is excluded from Google's index (THE headline claim)

**Precise wording for the pitch:** the page carries an explicit `noindex`
directive, and Google's live index confirms the page is absent (child project
pages are indexed; the hub is not). Do NOT say "your site isn't indexed" —
the rest of the site is. The claim is specifically about `/work`.

Evidence, three independent layers:

- **Raw server HTML** (not JS-injected): `work-page-live-2026-07-18.html`
  (fetched 2026-07-18 19:34 EDT, HTTP 200) contains
  `<meta name='robots' content='noindex, follow' />` in `<head>`.
  Reproduce: `curl -sL -A "<chrome-ua>" https://clockwork9.com/work | grep -i noindex`
- **Rendered DOM**: `../../scrape/pages/work.html` (Playwright capture, same day) — same tag.
- **Lighthouse**: `lighthouse/work-index--desktop.report.json` → audit
  `is-crawlable` score 0, snippet shows the meta tag.
- **Google's live index** (the effect, not just the directive), checked 2026-07-18:
  - `site:clockwork9.com/work` → returns only `/work/<project>` child pages; the hub itself never appears.
  - `"A collection of our favorite projects" site:clockwork9.com` (the page's unique subtitle) → **zero results**.
  - Reproduce in any browser; screenshot both SERPs when assembling the pitch deck.

Corroborating incoherence (defuses "it's intentional"): `/work` is absent from
`page-sitemap.xml` yet the broken `/blog/work/` archive IS in `work-sitemap.xml`;
`/work` also has no canonical and no meta description. No coherent SEO strategy
noindexes the portfolio hub while sitemapping a broken duplicate of it.

- Files: `seo-artifacts/page-sitemap.xml`, `seo-artifacts/work-sitemap.xml`
- `article:modified_time` on /work is 2025-08-19 — suggestive that the config
  is ≥11 months old, but NOT proof of when the tag appeared. Don't overclaim.

## 2. Six live test pages, publicly listed in the sitemap

- `seo-artifacts/page-sitemap.xml` lists `/test-expo/`, `/new-expo/`,
  `/another-test/`, `/test-22/`, `/final-test/`, `/test-test/`.
- Placeholder pricing live: `seo-artifacts/test-expo-live-2026-07-18.html` —
  `class="package-price">$1`, `addon-price">$3`, `addon-price">$2`, `total-price">$6`.
- Placeholder copy live: `../../scrape/pages/final-test.txt` line 71 —
  "Test Display Dates at the Test Location. Test Event Description".
- Reproduce: load any of those URLs in a browser.

## 3. Duplicate stale sitemap

- `seo-artifacts/sitemap.xml` (hand-rolled, lastmod values 2023) coexists with
  `seo-artifacts/sitemap_index.xml` (Yoast, current). `seo-artifacts/robots.txt`
  points at the Yoast one; the stale file is still served at /sitemap.xml.

## 4. Performance

- `lighthouse/home--mobile.report.html`: Perf 69, **LCP 8.1 s**, CLS 0.012.
- Mobile perf on content pages: EY 57, blog index 58, blog post 59
  (`lighthouse/*--mobile.report.json`).
- Third-party payload on every page (from any page's rendered head + script list):
  GTM, gtag, 2× Google Ads conversion, Hotjar, Google call-tracking, Cloudflare
  Insights, reCAPTCHA, jQuery 3.6, GSAP 3.11. See `../../scrape/pages/*.html`.
- NOTE: they run real Google Ads — conversion tracking must survive any rebuild;
  don't pitch "remove all trackers."

## 5. Accessibility (axe-core 111-page sweep)

- `audit-results.json` per-page `axeViolations`. Headlines: `color-contrast`
  (serious) 102 pages / 138 nodes; `link-in-text-block` (serious) 38 pages /
  246 nodes; `frame-title` (serious) all 24 Vimeo pages; `link-name` (serious)
  16 pages / 20 nodes; `heading-order` 26 pages.
- Reproduce: `audit/` contains the sweep script (`node audit/…`, sequential + throttled).

## 6. Broken things (all live-verified 2026-07-18)

- `/blog/work/` renders unstyled (raw default links, clipped heading, no grid)
  and is listed in `seo-artifacts/work-sitemap.xml`. Verified in browser.
- "View More Projects" on every project page is `<h3 class="related-title">` —
  no anchor. See `../../scrape/pages/work-nike.html`.
- Footer year hard-coded "2025© ALL RIGHTS RESERVED" — any page footer, plus
  every screenshot in `screenshots/`.
- Dead YouTube embed: `youtu.be/8q1jAZo2VUE` in the five-years post → oembed 404.
  Two more gray dead embeds visible in the Super Bowl post screenshot
  (`screenshots/blog-marketing-our-favorite-super-bowl-lvii-ads.png`).
- One true 404 link: Ignite Digi post links `ignitedigi.com.au` without protocol
  (resolves relative). `audit-results.json` → `linkcheck`.
- Expired event pages with urgency copy (Sept/Oct 2025 + "limited slots"):
  `screenshots/2025-oda-annual-session.png`, `aao-hnsf-2025.png`,
  `the-advanced-materials-show-usa.png`.
- 74/111 pages missing meta descriptions; 13 pages multiple h1s (home has 3);
  homepage stat "9+ years" vs. Stevie's stated 10 years. `audit-results.json` → `seo`.

## Ruled out — do NOT pitch (capture artifacts, verified healthy live)

- "Missing" blog/category thumbnails → native `loading="lazy"`, images 200 OK.
- "Broken/spinner" Vimeo embeds on work + event pages → normal iframes, verified live.
- "Empty related-post cards" / mid-article voids → same lazy-load pattern, unverified individually.
