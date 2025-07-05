import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWritableDestination, DestinationError } from '../src/write-guard.mjs';

test('direct guard reaches destination symlink, parent symlink and input hard-link branches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fixture-guard-'));
  const outside = mkdtempSync(join(tmpdir(), 'fixture-guard-out-'));
  try {
    const input = join(root, 'input.json');
    writeFileSync(input, 'original input');
    symlinkSync(input, join(root, 'destination.json'));
    await assert.rejects(assertWritableDestination(join(root, 'destination.json'), { root, inputs: [input] }), DestinationError);
    assert.equal(readFileSync(input, 'utf8'), 'original input');
    symlinkSync(outside, join(root, 'linked-parent'));
    await assert.rejects(assertWritableDestination(join(root, 'linked-parent', 'destination.json'), { root, inputs: [input] }), DestinationError);
    assert.equal(readFileSync(input, 'utf8'), 'original input');
    linkSync(input, join(root, 'hard-link.json'));
    await assert.rejects(assertWritableDestination(join(root, 'hard-link.json'), { root, inputs: [input] }), DestinationError);
    assert.equal(readFileSync(input, 'utf8'), 'original input');
    assert.equal(readFileSync(join(root, 'hard-link.json'), 'utf8'), 'original input');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('dangling named-input aliases refuse a future destination, distinct missing input allows it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fixture-dangle-'));
  try {
    const destination = join(root, 'report.json');
    symlinkSync('report.json', join(root, 'input.json'));
    await assert.rejects(assertWritableDestination(destination, { root, inputs: [join(root, 'input.json')] }), DestinationError);
    symlinkSync('middle.json', join(root, 'first.json'));
    symlinkSync('report.json', join(root, 'middle.json'));
    await assert.rejects(assertWritableDestination(destination, { root, inputs: [join(root, 'first.json')] }), DestinationError);
    assert.equal(await assertWritableDestination(destination, { root, inputs: [join(root, 'missing.json')] }), destination);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('filesystem root is a valid confinement root for a new destination', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fixture-root-'));
  try {
    const destination = join(root, 'report.json');
    assert.equal(await assertWritableDestination(destination, { root: '/', inputs: [] }), destination);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
