// Look for </script inside JS string literals in V70 Dashboard.html
// A `</script` anywhere in raw HTML inside a script block terminates it,
// regardless of string context — but very commonly bugs come from concatenated
// strings like '<\/script>' that the original author intended to keep escaped.
import { readFileSync } from 'node:fs';
const html = readFileSync('tmp/v70_Dashboard.html', 'utf8');

// Crude: find each </script case-insensitively, then check if it's the LAST
// thing in a contiguous block.
const lines = html.split('\n');
let inScript = false, scriptOpenedAt = -1;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.match(/<script[^>]*>/) && !inScript) {
    inScript = true;
    scriptOpenedAt = i + 1;
    continue;
  }
  if (inScript && line.match(/<\/script\s*>/i)) {
    inScript = false;
    continue;
  }
  if (inScript) {
    // Look for ANY </script even partial (browser HTML parser closes script tag on </script)
    const m = line.match(/<\/script/i);
    if (m) {
      console.log(`\n!! Line ${i + 1} contains </script inside script block opened at line ${scriptOpenedAt}:`);
      console.log('   ' + JSON.stringify(line.slice(Math.max(0, m.index - 60), m.index + 40)));
    }
  }
}
console.log('\nDone scanning.');
