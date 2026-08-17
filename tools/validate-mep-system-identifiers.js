'use strict';

// Guards against reintroducing hardcoded MEP system identifiers.
//
// Why: Archicad MEP system attribute index and name are project-, locale- and
// version-specific. A literal that works on one machine silently targets the
// wrong system (or fails) elsewhere. Commands must either omit the system so the
// Add-On picks the domain default via CreateRoutingElementDefault(Domain), or
// resolve it at runtime from GetAvailableSystems.
//
// Scope: files that feed real command execution or that an LLM copies from —
// descriptor registry, prompt/example payloads in server services, starter user
// assets, and the public example JSON. Schema `description` text and parameter
// declarations are allowed to mention the field name; only concrete values are
// rejected.

const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');

const scanTargets = [
  'ai-adapter/tool-descriptors.json',
  'ai-adapter/command-boundary.json',
  'server/services/llm-adapter.js',
  'server/services/ai-adapter.js',
  'server/services/task-templates.js',
  'examples/user-assets'
];

// "mepSystemName": "给水"      → concrete value, rejected
// "mepSystemIndex": 5          → concrete value, rejected
// mepSystemIndex=5             → concrete value inside prose/expected strings
// "mepSystemName": { "type":   → schema declaration, allowed
// params.mepSystemIndex = x    → runtime resolution in .js, allowed
const violationPatterns = [
  {
    pattern: /"mepSystemName"\s*:\s*"[^"]+"/g,
    label: 'hardcoded mepSystemName value',
    extensions: ['.json', '.js', '.md']
  },
  {
    pattern: /"mepSystemIndex"\s*:\s*\d+/g,
    label: 'hardcoded mepSystemIndex value',
    extensions: ['.json', '.js', '.md']
  },
  {
    // Prose form only. In .js an assignment like `params.mepSystemIndex = x` is
    // exactly the runtime resolution this rule wants, so .js is excluded here.
    pattern: /mepSystem(?:Name|Index)\s*[=＝]\s*[^\s,，}"]+/g,
    label: 'hardcoded MEP system identifier in text',
    extensions: ['.json', '.md']
  }
];

const failures = [];

function listFiles(target) {
  const absolute = path.join(workspace, target);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [absolute];

  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path.relative(workspace, child)));
    } else if (/\.(json|js|md)$/i.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

for (const target of scanTargets) {
  for (const filePath of listFiles(target)) {
    const relative = path.relative(workspace, filePath).replace(/\\/g, '/');
    const extension = path.extname(filePath).toLowerCase();
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { pattern, label, extensions } of violationPatterns) {
        if (!extensions.includes(extension)) continue;
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          failures.push(`${relative}:${index + 1} ${label}: ${match[0].trim()}`);
        }
      }
    });
  }
}

if (failures.length > 0) {
  console.error('MEP system identifier check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('');
  console.error('MEP system attribute index and name are not stable across projects,');
  console.error('locales or Archicad versions. Omit the system to use the domain');
  console.error('default, or resolve it at runtime via GetAvailableSystems.');
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  scannedTargets: scanTargets.length,
  violations: 0
}, null, 2));
