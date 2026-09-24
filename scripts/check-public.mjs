import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean);
const ignoredParts = new Set(['.git', 'node_modules', '.release', '.prune-demo']);
const privateNames = new Set(['session.json', 'plan.json', 'state.json', 'server.lock', '.env']);
const patterns = [
  ['personal home path', /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"']+|\/(?:Users|home)\/[^/\s"']+)/i],
  ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['credential prefix', /\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{16,}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['cloud access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
];
const failures = [];
for (const name of listed) {
  if (name.split('/').some(part => ignoredParts.has(part))) continue;
  if (privateNames.has(path.posix.basename(name)) || name.endsWith('.local.json')) {
    failures.push(`${name}: private runtime file`);
    continue;
  }
  const data = await fs.readFile(path.join(root, name));
  if (data.includes(0)) { failures.push(`${name}: binary file requires manual privacy review`); continue; }
  const content = data.toString('utf8');
  // Plugin config keys such as plugins.name@market.enabled are not email addresses.
  const withoutPluginKeys = content.replace(/plugins\.[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+\.enabled\b/g, '');
  for (const [label, pattern] of patterns) if (pattern.test(label === 'email address' ? withoutPluginKeys : content)) failures.push(`${name}: ${label}`);
}
if (failures.length) {
  console.error('Public-content check failed:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Public-content check passed (${listed.length} files).`);
}
