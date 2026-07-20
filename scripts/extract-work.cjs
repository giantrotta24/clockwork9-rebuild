/*
  Extract work-page content from the local scrape into src/data/work.json
  and copy referenced images into src/assets/work-pages/.
  Run from repo root: node scripts/extract-work.cjs
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'scrape/pages');
const ASSETS = path.join(ROOT, 'scrape/assets');
const OUT_IMG = path.join(ROOT, 'src/assets/work-pages');
const OUT_JSON = path.join(ROOT, 'src/data/work.json');

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8220;|&ldquo;/g, '“')
    .replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();

// local copy of a remote wp-content URL; returns repo-relative asset path or null
function copyAsset(url, slug) {
  const m = url.match(/wp-content\/(.*?)(?:\?|$)/);
  if (!m) return null;
  const rel = 'wp-content/' + m[1];
  const srcPath = path.join(ASSETS, rel);
  if (!fs.existsSync(srcPath)) {
    console.warn(`  MISSING asset for ${slug}: ${rel}`);
    return null;
  }
  const destDir = path.join(OUT_IMG, slug);
  fs.mkdirSync(destDir, { recursive: true });
  const base = path.basename(srcPath);
  fs.copyFileSync(srcPath, path.join(destDir, base));
  return `./work-pages/${slug}/${base}`; // relative to src/assets
}

// ---- work index: tile order + thumbnails ----
const indexHtml = fs.readFileSync(path.join(PAGES, 'work.html'), 'utf8');
const gridStart = indexHtml.indexOf('portfolio-grid') !== -1 ? indexHtml.indexOf('portfolio-grid') : 0;
const tileRe =
  /<a[^>]*href="https:\/\/clockwork9\.com\/work\/([a-z0-9-]+)\/?"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[^>]*>/g;
const tiles = [];
let tm;
while ((tm = tileRe.exec(indexHtml.slice(gridStart)))) {
  if (!tiles.find((t) => t.slug === tm[1])) tiles.push({ slug: tm[1], thumbUrl: tm[2] });
}
console.log(`index tiles: ${tiles.length}`);

// ---- per-page extraction ----
// found-surface-cavs is a live duplicate of cavs-cleveland-art-museum (same
// title + gallery); the rebuild redirects it (astro.config) instead of
// building it. Keep it excluded or the redirect will collide with a page.
const SKIP = new Set(['work-found-surface-cavs.html']);

const files = fs
  .readdirSync(PAGES)
  .filter((f) => /^work-[a-z0-9-]+\.html$/.test(f) && f !== 'work.html' && !SKIP.has(f));

const pages = [];
for (const file of files) {
  const slug = file.replace(/^work-/, '').replace(/\.html$/, '');
  const html = fs.readFileSync(path.join(PAGES, file), 'utf8');
  const main = (html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];

  const title = decode((main.match(/<h1 class="project-title">([\s\S]*?)<\/h1>/) || [])[1] || slug);
  const subtitle = decode((main.match(/<p class="project-subtitle">([\s\S]*?)<\/p>/) || [])[1] || '');

  const vimeoIds = [...new Set([...main.matchAll(/player\.vimeo\.com\/video\/(\d+)/g)].map((m) => m[1]))];

  // gallery images (project-gallery section only)
  const gallerySec = (main.match(/<div class="project-gallery[\s\S]*?(<section|<\/main>)/) || [])[0] || '';
  const gallery = [...new Set([...gallerySec.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]))]
    .map((u) => copyAsset(u, slug))
    .filter(Boolean);

  // related projects (preserve the original's per-page set)
  const relatedSec = (main.match(/<section class="related-projects"[\s\S]*?<\/section>/) || [''])[0];
  const related = [...relatedSec.matchAll(/href="https:\/\/clockwork9\.com\/work\/([a-z0-9-]+)\/?"/g)].map(
    (m) => m[1]
  );

  const tile = tiles.find((t) => t.slug === slug);
  const thumb = tile ? copyAsset(tile.thumbUrl, slug) : null;

  pages.push({
    slug,
    title,
    subtitle,
    vimeoIds,
    gallery,
    related: [...new Set(related)],
    thumb,
    order: tile ? tiles.indexOf(tile) : 999,
  });
  console.log(
    `${slug}: "${title}" video=${vimeoIds.length} gallery=${gallery.length} related=${related.length} thumb=${!!thumb}`
  );
}

pages.sort((a, b) => a.order - b.order);
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(pages, null, 2) + '\n');
console.log(`\nwrote ${pages.length} pages -> ${path.relative(ROOT, OUT_JSON)}`);
