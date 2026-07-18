// Parses the URL inventory markdown into { group: [urls] }
const fs = require('fs');
const path = require('path');

function parseInventory(mdPath) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const lines = text.split('\n');
  const groups = {};
  let currentGroup = null;
  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      currentGroup = headingMatch[1].trim();
      groups[currentGroup] = [];
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('https://') && currentGroup) {
      groups[currentGroup].push(trimmed);
    }
  }
  return groups;
}

module.exports = { parseInventory };

if (require.main === module) {
  const groups = parseInventory(process.argv[2]);
  let total = 0;
  for (const [g, urls] of Object.entries(groups)) {
    console.log(`${g}: ${urls.length}`);
    total += urls.length;
  }
  console.log(`TOTAL: ${total}`);
}
