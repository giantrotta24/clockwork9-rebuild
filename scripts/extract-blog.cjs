/*
  Extract WordPress blog posts from the local scrape into Astro content
  collection markdown: src/content/blog/<slug>/index.md, with images copied
  beside each post's index.md.

  Source: scrape/pages/blog-<category>-<slug>.html for category in
  creative|marketing|news|press|product-reviews|tutorials. Excludes
  blog.html, blog-work.html, blog-category-*.html, blog-tag-*.html,
  blog-author-*.html.

  Run from repo root: node scripts/extract-blog.cjs
*/
const fs = require('fs');
const path = require('path');
const TurndownService = require('turndown');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'scrape/pages');
const ASSETS = path.join(ROOT, 'scrape/assets');
const OUT_DIR = path.join(ROOT, 'src/content/blog');

const CATEGORIES = ['creative', 'marketing', 'news', 'press', 'product-reviews', 'tutorials'];

// YouTube video IDs confirmed dead via the oembed endpoint (404/401/403).
// 8q1jAZo2VUE, ZMlemd6U24Y and jfYdypGqbOs were flagged ahead of time;
// TvfN0JMaLTI, OQZTSDaPoA4 and JbImjyZQ3R4 turned up during the full sweep.
const DEAD_YOUTUBE_IDS = new Set([
  '8q1jAZo2VUE',
  'ZMlemd6U24Y',
  'jfYdypGqbOs',
  'TvfN0JMaLTI',
  'OQZTSDaPoA4',
  'JbImjyZQ3R4',
]);

// Six posts have no <meta name="description">. Written as factual
// 140-160 char summaries of the post body (no marketing fluff).
const MANUAL_DESCRIPTIONS = {
  'c9-celebrates-five-years-in-business':
    'Clockwork 9 marks its fifth anniversary as a business with a short video and a brief written thank-you note to clients, followers, and the team.',
  'four-years-in-the-making-clockwork-9':
    'Clockwork 9 marks four years in business, reflecting in a short post on team growth and the clients the studio has worked with since launching in 2016.',
  'the-best-wireless-follow-focus-system-for-the-buck-our-review-of-the-nucleus-m-from-tilta':
    'Clockwork 9 reviews the Tilta Nucleus M wireless follow focus system, comparing its motors, build quality, and price to their prior microRemote rig.',
  'uplift-its-more-than-a-desk':
    'Clockwork 9 reviews the UPLIFT height-adjustable standing desk, recounting their search for a replacement after years of using pallet-built furniture.',
  'using-the-zoom-f8-multitrack-field-recorder':
    'Clockwork 9 reviews the Zoom F8 multitrack field recorder, covering its travel case, eight XLR inputs, and iPad app control for on-set audio recording.',
  'mocha-pro-plugin-lens-module':
    'A step-by-step tutorial on using the Lens Module in the Mocha Pro plugin for Adobe Premiere to track and correct lens distortion in video footage.',
};

const report = {
  converted: [],
  deadEmbedsRemoved: [], // { slug, id }
  missingImages: [], // { slug, url }
  unusual: [], // { slug, note }
  totalImageBytes: 0,
};

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&#8220;|&ldquo;/g, '“')
    .replace(/&#8221;|&rdquo;/g, '”')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#8230;|&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// ---- asset copying (mirrors extract-work.cjs, with a same-basename
// size-variant fallback for the rare og:image whose exact filename wasn't
// captured by the scrape but a sized copy was) ----
function findLocalAsset(url) {
  const m = url.match(/wp-content\/(.*?)(?:\?|$)/);
  if (!m) return null;
  const rel = 'wp-content/' + m[1];
  const srcPath = path.join(ASSETS, rel);
  if (fs.existsSync(srcPath)) return srcPath;

  // fallback: same directory, same basename (minus extension) + a size
  // suffix, e.g. foo.gif missing but foo-1024x576.gif present.
  const dir = path.dirname(srcPath);
  const ext = path.extname(srcPath);
  const base = path.basename(srcPath, ext);
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(base + '-') && f.endsWith(ext))
    .map((f) => {
      const sizeMatch = f.match(/-(\d+)x(\d+)\.[^.]+$/);
      return { f, width: sizeMatch ? parseInt(sizeMatch[1], 10) : 0 };
    })
    .sort((a, b) => b.width - a.width);
  if (candidates.length) return path.join(dir, candidates[0].f);
  return null;
}

function copyAsset(url, destDir, slug, label) {
  const srcPath = findLocalAsset(url);
  if (!srcPath) {
    report.missingImages.push({ slug, url, label });
    return null;
  }
  fs.mkdirSync(destDir, { recursive: true });
  const base = path.basename(srcPath);
  const destPath = path.join(destDir, base);
  fs.copyFileSync(srcPath, destPath);
  report.totalImageBytes += fs.statSync(destPath).size;
  return `./${base}`;
}

// ---- build slug -> WordPress card excerpt map from category + main blog index pages ----
function buildExcerptMap() {
  const files = [
    'blog-category-creative.html',
    'blog-category-marketing.html',
    'blog-category-news.html',
    'blog-category-press.html',
    'blog-category-product-reviews.html',
    'blog-category-tutorials.html',
    'blog.html',
  ];
  const map = new Map();
  const re =
    /<a href="https:\/\/clockwork9\.com\/blog\/[a-z0-9-]+\/([a-z0-9-]+)\/" class="blog-card">[\s\S]*?<p class="blog-excerpt">\s*([\s\S]*?)\s*<\/p>/g;
  for (const file of files) {
    const p = path.join(PAGES, file);
    if (!fs.existsSync(p)) continue;
    const html = fs.readFileSync(p, 'utf8');
    let m;
    const localRe = new RegExp(re.source, 'g');
    while ((m = localRe.exec(html))) {
      if (!map.has(m[1])) {
        let excerpt = decode(m[2]);
        // strip a stray leading bare video URL left over from WP's
        // auto-excerpt when no manual excerpt was set on the post.
        excerpt = excerpt.replace(/^https?:\/\/youtu\.be\/\S+\s*/i, '').trim();
        map.set(m[1], excerpt);
      }
    }
  }
  return map;
}

// ---- turndown setup: keep <iframe> as raw HTML for video embeds ----
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});
turndownService.keep(['iframe']);

function ytIframe(id, title) {
  const safeTitle = title || 'YouTube video';
  return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${id}" title="${safeTitle.replace(/"/g, '&quot;')}" loading="lazy" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
}

function vimeoIframe(src, title) {
  const safeTitle = title || 'Vimeo video';
  return `<iframe width="640" height="360" src="${src}" title="${safeTitle.replace(/"/g, '&quot;')}" loading="lazy" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
}

function processVideos(body, slug, postTitle) {
  // YouTube lyte-lazyload embeds
  body = body.replace(
    /<figure class="wp-block-embed-youtube[^"]*"[^>]*>[\s\S]*?<\/figure>/g,
    (match) => {
      const idMatch = match.match(/id="WYL_([A-Za-z0-9_-]+)"/);
      if (!idMatch) return match; // not a recognized youtube embed shape
      const id = idMatch[1];
      const titleMatch =
        match.match(/class="lyte-wrapper" title="([^"]*)"/) ||
        match.match(/itemprop="name">([^<]*)</) ||
        match.match(/<figcaption>([^<]+)<\/figcaption>/);
      const title = titleMatch ? decode(titleMatch[1]) : postTitle;

      if (DEAD_YOUTUBE_IDS.has(id)) {
        report.deadEmbedsRemoved.push({ slug, id });
        return '';
      }
      return ytIframe(id, title);
    }
  );

  // Vimeo iframes wrapped in a padding-bottom aspect-ratio div, optionally
  // followed by the player.js loader script tag.
  body = body.replace(
    /<div style="padding:56\.25% 0 0 0;position:relative;">([\s\S]*?)<\/div>(?:\s*<script src="https:\/\/player\.vimeo\.com\/api\/player\.js"><\/script>)?/g,
    (match, inner) => {
      const srcMatch = inner.match(/<iframe[^>]*src="(https:\/\/player\.vimeo\.com\/video\/[^"]*)"/);
      if (!srcMatch) return match; // not a vimeo embed, leave untouched
      const titleMatch = inner.match(/title="([^"]*)"/);
      const title = titleMatch ? decode(titleMatch[1]) : postTitle;
      return vimeoIframe(srcMatch[1], title);
    }
  );

  return body;
}

// Converts a <table>...</table> block to a GFM markdown table. Used for the
// Zoom F8 post's spec-sheet table, whose header row is <td><strong> rather
// than <th>, so turndown's own table handling doesn't recognize it.
function htmlTableToMarkdown(tableHtml) {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const cellsForRow = (row) =>
    [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      decode(
        m[1]
          .replace(/<\/?strong>|<\/?b>/gi, '')
          .replace(/<br\s*\/?>/gi, '; ')
          .replace(/<[^>]+>/g, ' ')
      ).replace(/^;\s*|(;\s*)+$/g, '')
    );
  if (!rows.length) return '';
  const table = rows.map(cellsForRow);
  const colCount = Math.max(...table.map((r) => r.length));
  const pad = (r) => {
    const out = r.slice();
    while (out.length < colCount) out.push('');
    return out;
  };
  const toLine = (r) => `| ${pad(r).map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  const header = toLine(table[0]);
  const divider = `| ${Array(colCount).fill('---').join(' | ')} |`;
  const body = table.slice(1).map(toLine).join('\n');
  return [header, divider, body].filter(Boolean).join('\n');
}

// Pulls any <table> out of the HTML body, converts it to markdown directly,
// and swaps in a placeholder so turndown (which doesn't reliably render
// non-<th> tables) can't mangle it. Placeholders are restored after turndown.
function extractTables(body) {
  const placeholders = [];
  body = body.replace(/<table>[\s\S]*?<\/table>/g, (match) => {
    const md = htmlTableToMarkdown(match);
    // no underscores/asterisks: turndown backslash-escapes those in text
    // nodes, which would break a literal string match on the token later.
    const token = `TABLEPLACEHOLDERTOKEN${placeholders.length}END`;
    placeholders.push(md);
    return `<p>${token}</p>`;
  });
  return { body, placeholders };
}

function restoreTables(markdown, placeholders) {
  placeholders.forEach((md, i) => {
    markdown = markdown.replace(`TABLEPLACEHOLDERTOKEN${i}END`, md);
  });
  return markdown;
}

function stripCruft(body) {
  // Gravity Forms embedded lead-gen widgets (form markup + its init script).
  body = body.replace(/<div class="gf_browser[\s\S]*?<\/script>/g, '');
  // Google AdSense in-article ad units.
  body = body.replace(/<ins class="adsbygoogle"[\s\S]*?<\/ins>/g, '');
  return body;
}

function fixIgniteDigiLink(body) {
  return body.replace('href="ignitedigi.com.au"', 'href="https://ignitedigi.com.au"');
}

function processImages(body, slug, destDir) {
  // Matches any <figure>...</figure> that directly wraps an <img> (covers
  // wp-block-image, aligncenter size-*, and the first inner image of a
  // wp-block-gallery). Figures with no <img> inside (e.g. the wp-block-table
  // spec sheet in the Zoom F8 post) are left untouched for turndown's GFM
  // table rule to handle.
  return body.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/g, (match, inner) => {
    const imgMatch = inner.match(/<img[^>]*src="([^"]*)"[^>]*>/);
    if (!imgMatch) return match;
    const srcAttr = imgMatch[0];
    const url = imgMatch[1];
    const altMatch = srcAttr.match(/alt="([^"]*)"/);
    const alt = altMatch ? decode(altMatch[1]) : '';
    const rel = copyAsset(url, destDir, slug, 'body image');
    if (!rel) return '';
    const img = `<img src="${rel}" alt="${alt.replace(/"/g, '&quot;')}">`;
    // preserve an <a href> that wraps the image (e.g. the Ignite Digi post's
    // linked product photo) instead of dropping it with the rest of the figure.
    const linkMatch = inner.match(/<a href="([^"]*)"[^>]*>\s*<img[^>]*>\s*<\/a>/);
    if (linkMatch) return `<a href="${linkMatch[1]}">${img}</a>`;
    return img;
  });
}

function extractEntryContent(html) {
  const startTag = '<div class="entry-content">';
  const startIdx = html.indexOf(startTag);
  const articleCloseIdx = html.lastIndexOf('</article>');
  if (startIdx === -1 || articleCloseIdx === -1) return null;
  let body = html.slice(startIdx + startTag.length, articleCloseIdx).trim();
  if (body.endsWith('</div>')) {
    body = body.slice(0, -'</div>'.length).trim();
  }
  return body;
}

function firstNWords(text, n) {
  const words = text
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return decode(words.slice(0, n).join(' '));
}

function toYAMLString(s) {
  // single-quoted YAML scalar; escape embedded single quotes by doubling.
  return `'${String(s).replace(/'/g, "''")}'`;
}

// ---- main ----
const excerptMap = buildExcerptMap();

const files = fs
  .readdirSync(PAGES)
  .filter((f) => new RegExp(`^blog-(${CATEGORIES.join('|')})-[a-z0-9-]+\\.html$`).test(f));

console.log(`Found ${files.length} qualifying blog post files.\n`);

for (const file of files) {
  const category = CATEGORIES.find((c) => file.startsWith(`blog-${c}-`));
  const slug = file.slice(`blog-${category}-`.length, -'.html'.length);
  const html = fs.readFileSync(path.join(PAGES, file), 'utf8');
  const destDir = path.join(OUT_DIR, slug);

  const titleMatch = html.match(/<h1 class="entry-title">([\s\S]*?)<\/h1>/);
  const title = titleMatch ? decode(titleMatch[1]) : slug;

  const bylineMatch = html.match(/<div class="name-of-author">([\s\S]*?)<\/div>/);
  let author = 'Clockwork 9';
  let date = null;
  if (bylineMatch) {
    const authorMatch = bylineMatch[1].match(/<a[^>]*>\s*([^<]+?)\s*<\/a>/);
    if (authorMatch) author = decode(authorMatch[1]);
    const dateMatch = bylineMatch[1].match(/(\d{2})-(\d{2})-(\d{4})/);
    if (dateMatch) date = `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`;
  }
  if (!date) {
    const publishedMatch = html.match(/property="article:published_time" content="([^"]*)"/);
    if (publishedMatch) date = publishedMatch[1].slice(0, 10);
  }
  if (!date) {
    report.unusual.push({ slug, note: 'no date found on byline or article:published_time' });
  }

  const descMatch = html.match(/<meta name="description" content="([^"]*)"/);
  let description = descMatch ? decode(descMatch[1]) : MANUAL_DESCRIPTIONS[slug];
  if (!description) {
    report.unusual.push({ slug, note: 'no meta description and no manual override' });
    description = firstNWords(extractEntryContent(html) || '', 25);
  }

  const ogImageMatch = html.match(/property="og:image" content="([^"]*)"/);
  const thumbAltMatch = html.match(/class="post-thumbnail">[\s\S]*?<img[^>]*alt="([^"]*)"/);
  const heroAlt = thumbAltMatch ? decode(thumbAltMatch[1]) : '';
  let hero = null;
  if (ogImageMatch) {
    hero = copyAsset(ogImageMatch[1], destDir, slug, 'hero image');
  }

  let excerpt = excerptMap.get(slug);
  let body = extractEntryContent(html);
  if (!excerpt) {
    excerpt = firstNWords(body || '', 30);
    report.unusual.push({ slug, note: 'no WP card excerpt found; used first ~30 words of body' });
  }

  if (body === null) {
    report.unusual.push({ slug, note: 'could not locate entry-content region' });
    continue;
  }

  body = stripCruft(body);
  const { body: bodyNoTables, placeholders: tablePlaceholders } = extractTables(body);
  body = bodyNoTables;
  body = processVideos(body, slug, title);
  body = fixIgniteDigiLink(body);
  body = processImages(body, slug, destDir);

  let markdown = turndownService.turndown(body).trim();
  markdown = restoreTables(markdown, tablePlaceholders);

  const frontmatter = [
    '---',
    `title: ${toYAMLString(title)}`,
    `description: ${toYAMLString(description)}`,
    `date: ${date || ''}`,
    `author: ${toYAMLString(author)}`,
    `category: ${category}`,
    ...(hero ? [`hero: ${toYAMLString(hero)}`] : []),
    `heroAlt: ${toYAMLString(heroAlt)}`,
    `excerpt: ${toYAMLString(excerpt)}`,
    '---',
    '',
  ].join('\n');

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'index.md'), frontmatter + markdown + '\n');

  report.converted.push(slug);
  console.log(
    `${slug}: title="${title}" author=${author} date=${date} hero=${!!hero} desc=${description.length}ch excerpt=${excerpt.length}ch`
  );
}

console.log(`\n--- Report ---`);
console.log(`Converted: ${report.converted.length}/${files.length}`);
console.log(`Dead embeds removed: ${report.deadEmbedsRemoved.length}`);
for (const d of report.deadEmbedsRemoved) console.log(`  - ${d.slug}: ${d.id}`);
console.log(`Missing images dropped: ${report.missingImages.length}`);
for (const mi of report.missingImages) console.log(`  - ${mi.slug} [${mi.label}]: ${mi.url}`);
console.log(`Unusual posts: ${report.unusual.length}`);
for (const u of report.unusual) console.log(`  - ${u.slug}: ${u.note}`);
console.log(`Total copied image bytes: ${report.totalImageBytes} (${(report.totalImageBytes / 1024 / 1024).toFixed(2)} MB)`);
