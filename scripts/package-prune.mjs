import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inside, physicalPath, validatePackage } from '../skills/prune/scripts/engine.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const shared = ['scripts/engine.mjs', 'scripts/prune.mjs', 'scripts/plugin-host.mjs', 'assets/workbench.html'];
const localized = ['SKILL.md', 'agents/openai.yaml', 'references/strong-model-review-rules.md', 'references/contract.md'];

// Language variants share one runtime source; released packages are standalone.
export async function packagePrune(output) {
  const out = await physicalPath(path.resolve(output));
  for (const source of ['skills', 'locales']) {
    if (inside(await physicalPath(path.join(repo, source)), out)) throw new Error('Output must be outside skill and locale sources');
  }
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.mkdir(out); // Refuse existing output; never overwrite another delivery.
  const packages = [];
  for (const [language, source] of [['zh', 'skills/prune'], ['en', 'locales/prune/en']]) {
    const folder = path.join(out, language, 'prune');
    for (const file of [...localized, ...shared]) {
      const target = path.join(folder, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(repo, shared.includes(file) ? 'skills/prune' : source, file), target);
    }
    for (const document of ['LICENSE', 'NOTICE']) {
      await fs.copyFile(path.join(repo, document), path.join(out, language, document));
    }
    const fingerprint = await validatePackage(folder);
    packages.push({ language, folder, files: fingerprint.entries.filter(entry => entry.type === 'file') });
  }
  // Keep publishable manifests independent of the builder's home directory.
  const manifest = packages.map(({ language, files }) => ({ language, folder: `${language}/prune`, files }));
  await fs.writeFile(path.join(out, 'packages.json'), JSON.stringify({ packages: manifest }, null, 2) + '\n');
  return packages;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/package-prune.mjs <new-output-directory>');
  const packages = await packagePrune(process.argv[2]);
  console.log(`Built ${packages.map(({ language }) => language).join(' and ')} packages; see packages.json for relative paths and fingerprints.`);
}
