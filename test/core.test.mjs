import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtureSet, ConfigError, TOOL_ID } from '../src/index.mjs';

const valid = (overrides = {}) => ({ schemaVersion: 1, seed: 0, groups: 2, itemsPerGroup: 3, ...overrides });
const names = result => result.artifacts.map(item => item.name);
const json = (result, name) => JSON.parse(result.artifacts.find(item => item.name === name).bytes);

test('a zero-seed clean set is deterministic and every item names one generated group', () => {
  assert.equal(TOOL_ID, 'local-fixture-seeder');
  const first = buildFixtureSet(valid(), { now: () => 0 });
  const second = buildFixtureSet(valid(), { now: () => 0 });
  assert.equal(first.report.status, 'pass');
  assert.equal(first.report.summary.checked, 8);
  assert.deepEqual(names(first), ['groups.json', 'items.json', 'reset-manifest.json']);
  assert.deepEqual(first.artifacts, second.artifacts);
  assert.notEqual(first.artifacts[0].bytes,
    buildFixtureSet(valid({ seed: 1 }), { now: () => 0 }).artifacts[0].bytes);
  const groups = json(first, 'groups.json');
  const items = json(first, 'items.json');
  assert.equal(new Set(groups.map(item => item.id)).size, 2);
  assert.equal(new Set(items.map(item => item.id)).size, 6);
  assert.ok(items.every(item => groups.some(group => group.id === item.groupId)));
  const manifest = json(first, 'reset-manifest.json');
  assert.deepEqual(manifest.artifacts.map(item => item.path), ['groups.json', 'items.json']);
});

test('the largest supported zero-seed set retains distinct references', () => {
  const result = buildFixtureSet(valid({ groups: 32, itemsPerGroup: 16 }), { now: () => 0 });
  assert.equal(result.report.status, 'pass');
  assert.equal(result.report.summary.checked, 544);
  const groups = json(result, 'groups.json');
  const items = json(result, 'items.json');
  const ids = new Set(groups.map(item => item.id));
  assert.equal(ids.size, 32);
  assert.equal(new Set(items.map(item => item.id)).size, 512);
  assert.ok(items.every(item => ids.has(item.groupId)));
});

test('invalid or unsupported profile evidence never produces artifacts', () => {
  for (const profile of [null, {}, valid({ groups: 0 }), valid({ seed: 4294967296 }), valid({ surprise: true })]) {
    const result = buildFixtureSet(profile, { now: () => 0 });
    assert.equal(result.report.status, 'incomplete');
    assert.deepEqual(result.artifacts, []);
  }
});

test('seed upper bound accepts N and refuses N plus one', () => {
  assert.equal(buildFixtureSet(valid({ seed: 4294967295 }), { now: () => 0 }).report.status, 'pass');
  assert.equal(buildFixtureSet(valid({ seed: 4294967296 }), { now: () => 0 }).report.status, 'incomplete');
});

test('a library accessor cannot change a validated record count after checking', () => {
  const profile = valid();
  Object.defineProperty(profile, 'groups', { enumerable: true, get: () => 1 });
  const result = buildFixtureSet(profile, { now: () => 0 });
  assert.equal(result.report.status, 'incomplete');
  assert.deepEqual(result.artifacts, []);
});

test('all record bounds accept N and refuse N plus one', () => {
  const cases = [
    [valid({ groups: 32, itemsPerGroup: 1 }), valid({ groups: 33, itemsPerGroup: 1 })],
    [valid({ groups: 1, itemsPerGroup: 32 }), valid({ groups: 1, itemsPerGroup: 33 })],
    [valid({ groups: 32, itemsPerGroup: 16 }), valid({ groups: 19, itemsPerGroup: 27 })],
  ];
  for (const [legal, tooMany] of cases) {
    assert.equal(buildFixtureSet(legal, { now: () => 0 }).report.status, 'pass');
    const refused = buildFixtureSet(tooMany, { now: () => 0 });
    assert.equal(refused.report.status, 'incomplete');
    assert.deepEqual(refused.artifacts, []);
  }
});

test('unknown analysis limits and invalid injected clocks cannot silently pass', () => {
  assert.throws(() => buildFixtureSet(valid(), { limits: JSON.parse('{"toString":1}') }), ConfigError);
  assert.throws(() => buildFixtureSet(valid(), { limits: { maxGroups: 0 } }), ConfigError);
  const accessorLimit = {};
  Object.defineProperty(accessorLimit, 'maxGroups', { enumerable: true, get: () => 1 });
  assert.throws(() => buildFixtureSet(valid(), { limits: accessorLimit }), ConfigError);
  const accessorOption = {};
  Object.defineProperty(accessorOption, 'now', { enumerable: true, get: () => () => 0 });
  assert.throws(() => buildFixtureSet(valid(), accessorOption), ConfigError);
  assert.throws(() => buildFixtureSet(valid(), { now: () => Number.NaN }), ConfigError);
  let reading = 0;
  assert.throws(() => buildFixtureSet(valid(), { now: () => reading-- }), ConfigError);
  assert.equal(buildFixtureSet(valid(), { now: () => 0, limits: { timeoutMs: 1 } }).report.status, 'pass');
  let exactRead = 0;
  assert.equal(buildFixtureSet(valid(), { now: () => exactRead++ === 0 ? 0 : 1, limits: { timeoutMs: 1 } }).report.status, 'pass');
  let overRead = 0;
  assert.equal(buildFixtureSet(valid(), { now: () => overRead++ === 0 ? 0 : 2, limits: { timeoutMs: 1 } }).report.status, 'incomplete');
  let ticks = 0;
  assert.equal(buildFixtureSet(valid(), { now: () => ticks++, limits: { timeoutMs: 1 } }).report.status, 'incomplete');
});
