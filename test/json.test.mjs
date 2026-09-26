import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFixtureJson, EvidenceError } from '../src/json.mjs';

test('strict saved JSON accepts canonical integer evidence and rejects ambiguity', () => {
  assert.deepEqual(parseFixtureJson('{"schemaVersion":1,"seed":0,"groups":1,"itemsPerGroup":1}'),
    { schemaVersion: 1, seed: 0, groups: 1, itemsPerGroup: 1 });
  for (const text of [
    '{"seed":1,"seed":2}', '{"s\\u0065ed":1,"seed":2}',
    '{"seed":1.0}', '{"seed":1e0}', '{"seed":-0}', '{"seed":4294967296}',
    '{"seed":01}', '{"seed":1,}', '{"seed":"unterminated}',
  ]) assert.throws(() => parseFixtureJson(text), EvidenceError);
});

test('JSON depth and node ceilings accept N and refuse N plus one', () => {
  assert.deepEqual(parseFixtureJson('[[0]]', { maxDepth: 2, maxNodes: 3 }), [[0]]);
  assert.throws(() => parseFixtureJson('[[[0]]]', { maxDepth: 2, maxNodes: 4 }), EvidenceError);
  assert.throws(() => parseFixtureJson('[[0]]', { maxDepth: 2, maxNodes: 2 }), EvidenceError);
});

test('untrusted malformed JSON never appears in diagnostics', () => {
  const canary = 'token=SYNTHETIC_SECRET_CANARY';
  assert.throws(() => parseFixtureJson(`{"seed":${canary}}`), error => {
    assert.equal(error instanceof EvidenceError, true);
    assert.equal(error.message.includes(canary), false);
    return true;
  });
});
