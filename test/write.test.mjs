import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixtureSet } from '../src/index.mjs';
import { writeFixtureSet, WriteError } from '../src/write.mjs';
import { DestinationError } from '../src/write-guard.mjs';

const artifacts = () => buildFixtureSet({ schemaVersion: 1, seed: 0, groups: 1, itemsPerGroup: 1 }, { now: () => 0 }).artifacts;
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'fixture-write-'));
  mkdirSync(join(root, 'out'));
  writeFileSync(join(root, 'input.json'), 'protected input');
  return { root, out: join(root, 'out'), input: join(root, 'input.json') };
};

test('explicit empty destination writes exact deterministic bytes and manifest last', async () => {
  const place = setup();
  try {
    const result = await writeFixtureSet({ ...place, artifacts: artifacts() });
    assert.deepEqual(result, ['groups.json', 'items.json', 'reset-manifest.json']);
    for (const artifact of artifacts()) {
      assert.equal(readFileSync(join(place.out, artifact.name), 'utf8'), artifact.bytes);
    }
    assert.equal(readFileSync(place.input, 'utf8'), 'protected input');
    await assert.rejects(writeFixtureSet({ ...place, artifacts: artifacts() }), WriteError);
  } finally { rmSync(place.root, { recursive: true, force: true }); }
});

test('the writer itself calls the guard before creating a dangling input alias', async () => {
  const place = setup();
  try {
    rmSync(place.input);
    symlinkSync('out/groups.json', place.input);
    await assert.rejects(writeFixtureSet({ ...place, artifacts: artifacts() }), error => {
      assert.equal(error instanceof WriteError, true);
      assert.equal(error.ruleId, 'write-refused');
      assert.equal(error.cause instanceof DestinationError, true);
      return true;
    });
    assert.deepEqual(readdirSync(place.out), []);
  } finally { rmSync(place.root, { recursive: true, force: true }); }
});

test('destination symlink and hard link never alter their protected targets', async () => {
  for (const alias of ['symlink', 'hardlink']) {
    const place = setup();
    try {
      if (alias === 'symlink') symlinkSync(place.input, join(place.out, 'groups.json'));
      else linkSync(place.input, join(place.out, 'groups.json'));
      await assert.rejects(writeFixtureSet({ ...place, artifacts: artifacts() }), error => {
        assert.equal(error instanceof WriteError, true);
        assert.equal(error.ruleId, 'write-refused');
        assert.equal(error.cause instanceof DestinationError, true);
        return true;
      });
      assert.equal(readFileSync(place.input, 'utf8'), 'protected input');
      assert.equal(readFileSync(join(place.out, 'groups.json'), 'utf8'), 'protected input');
      assert.equal(readdirSync(place.out).includes('reset-manifest.json'), false);
    } finally { rmSync(place.root, { recursive: true, force: true }); }
  }
});

test('an unrelated pre-existing file prevents generation without deletion', async () => {
  const place = setup();
  try {
    writeFileSync(join(place.out, 'unrelated.txt'), 'keep me');
    await assert.rejects(writeFixtureSet({ ...place, artifacts: artifacts() }), error => {
      assert.equal(error.ruleId, 'output-not-empty');
      return true;
    });
    assert.deepEqual(readdirSync(place.out), ['unrelated.txt']);
    assert.equal(readFileSync(join(place.out, 'unrelated.txt'), 'utf8'), 'keep me');
  } finally { rmSync(place.root, { recursive: true, force: true }); }
});
