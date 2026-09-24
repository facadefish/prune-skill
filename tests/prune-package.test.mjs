import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagePrune } from '../scripts/package-prune.mjs';

test('Both language packages are standalone and preserve the temporary apply/restore contract', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prune-package-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert(path.basename(root).startsWith('prune-package-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const out = path.join(root, 'delivery');
  const packages = await packagePrune(out);
  await assert.rejects(packagePrune(out), { code: 'EEXIST' });
  const manifestBefore = await fs.readFile(path.join(out, 'packages.json'));
  const manifest = JSON.parse(manifestBefore);
  assert.deepEqual(manifest.packages.map(({ folder }) => folder), ['zh/prune', 'en/prune']);
  assert(!manifestBefore.toString().includes(root), 'release manifest must not include the builder path');
  for (const packaged of packages) {
    assert.equal(packaged.files.length, 8);
    for (const document of ['LICENSE', 'NOTICE']) {
      assert.deepEqual(await fs.readFile(path.join(out, packaged.language, document)), await fs.readFile(new URL(`../${document}`, import.meta.url)));
    }
    for (const shared of ['scripts/engine.mjs', 'scripts/prune.mjs', 'scripts/plugin-host.mjs', 'assets/workbench.html']) {
      assert.equal(packaged.files.find(f => f.path === shared).hash, packages[0].files.find(f => f.path === shared).hash);
    }
    const { fingerprint } = await import(pathToFileURL(path.join(packaged.folder, 'scripts/engine.mjs')));
    const { demo, serve } = await import(pathToFileURL(path.join(packaged.folder, 'scripts/prune.mjs')));
    const demoRoot = path.join(root, `demo-${packaged.language}`);
    const run = await demo(demoRoot, 5);
    const service = await serve(run, { lockRoot: path.join(demoRoot, 'locks') });
    try {
      const response = await fetch(service.base);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), await fs.readFile(path.join(packaged.folder, 'assets/workbench.html'), 'utf8'));
      const wb = service.workbench;
      const item = wb.plan.items.find(candidate => candidate.action === 'modify');
      const source = path.join(demoRoot, 'skills', item.id);
      const original = await fingerprint(source);
      const args = { planFingerprint: wb.plan.fingerprint, itemIds: [item.id] };
      await assert.rejects(wb.start('apply', { ...args, requestId: 'unapproved' }));
      await wb.select(wb.plan.fingerprint, { [item.id]: 'approved' });
      const applied = await wb.start('apply', { ...args, requestId: 'apply' });
      await wb.pending;
      assert.equal(applied.status, 'completed');
      assert.notEqual((await fingerprint(source)).hash, original.hash);
      const restored = await wb.start('restore', { ...args, requestId: 'restore', operationId: applied.id });
      await wb.pending;
      assert.equal(restored.status, 'completed');
      assert.deepEqual(await fingerprint(source), original);
      assert.equal(wb.state.selection[item.id], 'none');
    } finally {
      await service.close();
    }
  }
  assert.deepEqual(await fs.readFile(path.join(out, 'packages.json')), manifestBefore);
});
