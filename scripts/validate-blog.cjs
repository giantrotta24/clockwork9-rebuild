/*
  Validates src/content/blog/<slug>/index.md against the shape required by
  src/content.config.ts, without running `astro build` (templates aren't
  ready yet). Checks:
    - frontmatter parses and has all required fields
    - description >= 20 chars, excerpt >= 10 chars
    - category is one of the six enum values
    - hero file exists on disk when referenced

  Run from repo root: node scripts/validate-blog.cjs
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const CATEGORIES = new Set(['creative', 'marketing', 'news', 'press', 'product-reviews', 'tutorials']);

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const lines = m[1].split('\n');
  const data = {};
  for (const line of lines) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!kv) continue;
    let [, key, value] = kv;
    value = value.trim();
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    data[key] = value;
  }
  return data;
}

const slugs = fs.readdirSync(BLOG_DIR).filter((f) => fs.statSync(path.join(BLOG_DIR, f)).isDirectory());
let errors = 0;
let checked = 0;

for (const slug of slugs) {
  const mdPath = path.join(BLOG_DIR, slug, 'index.md');
  if (!fs.existsSync(mdPath)) {
    console.error(`[FAIL] ${slug}: no index.md`);
    errors++;
    continue;
  }
  checked++;
  const raw = fs.readFileSync(mdPath, 'utf8');
  const fm = parseFrontmatter(raw);
  if (!fm) {
    console.error(`[FAIL] ${slug}: frontmatter did not parse`);
    errors++;
    continue;
  }

  const required = ['title', 'description', 'date', 'author', 'category', 'excerpt'];
  for (const field of required) {
    if (!fm[field]) {
      console.error(`[FAIL] ${slug}: missing required field "${field}"`);
      errors++;
    }
  }

  if (fm.description && fm.description.length < 20) {
    console.error(`[FAIL] ${slug}: description too short (${fm.description.length} chars)`);
    errors++;
  }
  if (fm.excerpt && fm.excerpt.length < 10) {
    console.error(`[FAIL] ${slug}: excerpt too short (${fm.excerpt.length} chars)`);
    errors++;
  }
  if (fm.category && !CATEGORIES.has(fm.category)) {
    console.error(`[FAIL] ${slug}: category "${fm.category}" not in enum`);
    errors++;
  }
  if (fm.date && Number.isNaN(new Date(fm.date).getTime())) {
    console.error(`[FAIL] ${slug}: date "${fm.date}" does not parse`);
    errors++;
  }
  if (fm.hero) {
    const heroPath = path.join(BLOG_DIR, slug, fm.hero.replace(/^\.\//, ''));
    if (!fs.existsSync(heroPath)) {
      console.error(`[FAIL] ${slug}: hero file "${fm.hero}" does not exist`);
      errors++;
    }
  }

  // sanity-check the body isn't empty
  const body = raw.slice(raw.indexOf('\n---', 4) + 4).trim();
  if (!body) {
    console.error(`[FAIL] ${slug}: empty body`);
    errors++;
  }
}

console.log(`\nChecked ${checked} posts, ${errors} error(s).`);
process.exit(errors ? 1 : 0);
