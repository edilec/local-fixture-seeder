import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = resolve('bin/local-fixture-seeder.mjs');
const guard = resolve('support/deny-network.mjs');
const run = (...args) => spawnSync(process.execPath, ['--import', guard, bin, ...args], { encoding: 'utf8' });
const clean = readFileSync(resolve('examples/clean/config.json'));
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'fixture-cli-'));
  mkdirSync(join(root, 'out'));
  writeFileSync(join(root, 'config.json'), clean);
  return root;
};

test('real CLI writes deterministic synthetic files and a hash-bearing manifest', () => {
  const first = setup();
  const second = setup();
  try {
    const one = run('--root', first, '--input', 'config.json', '--out', 'out');
    const two = run('--root', second, '--input', 'config.json', '--out', 'out');
    assert.equal(one.status, 0, one.stderr);
    assert.equal(two.status, 0, two.stderr);
    assert.equal(JSON.parse(one.stdout).status, 'pass');
    assert.equal(JSON.parse(one.stdout).summary.checked, 6);
    assert.match(one.stderr, /^pass: 6 records, 3 files\n$/u);
    assert.equal(one.stdout, two.stdout);
    for (const name of ['groups.json', 'items.json', 'reset-manifest.json']) {
      assert.equal(readFileSync(join(first, 'out', name), 'utf8'), readFileSync(join(second, 'out', name), 'utf8'));
    }
    const manifest = JSON.parse(readFileSync(join(first, 'out/reset-manifest.json'), 'utf8'));
    assert.deepEqual(manifest.artifacts.map(item => item.path), ['groups.json', 'items.json']);
  } finally { rmSync(first, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); }
});

test('incomplete example, missing input, and duplicate keys never write artifacts', () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'config.json'), readFileSync(resolve('examples/failing/config.json')));
    let child = run('--root', root, '--input', 'config.json', '--out', 'out');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(item => item.ruleId), ['input-limit']);
    assert.deepEqual(readdirSync(join(root, 'out')), []);
    child = run('--root', root, '--input', 'missing.json', '--out', 'out');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(item => item.ruleId), ['input-unreadable']);
    writeFileSync(join(root, 'config.json'), '{"seed":0,"seed":1}');
    child = run('--root', root, '--input', 'config.json', '--out', 'out');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(item => item.ruleId), ['input-unreadable']);
    assert.deepEqual(readdirSync(join(root, 'out')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('help, JSON-only mode, and invalid configuration have distinct streams', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root DIR --input FILE --out DIR/u);
  assert.equal(help.stderr, '');
  const unknown = run('--json', '--bad-option');
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, '');
  assert.equal(unknown.stderr, 'Invalid CLI configuration.\n');
  const rootFile = run('--root', resolve('package.json'), '--input', 'x', '--out', 'y');
  assert.equal(rootFile.status, 2);
  assert.equal(rootFile.stdout, '');
  const root = setup();
  try {
    const json = run('--root', root, '--input', 'config.json', '--out', 'out', '--json');
    assert.equal(json.status, 0);
    assert.equal(json.stderr, '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('named path, symlink escape, and root slash do not misstate provenance', () => {
  const root = setup();
  const outside = mkdtempSync(join(tmpdir(), 'fixture-outside-'));
  try {
    writeFileSync(join(root, 'token-SYNTHETIC_SECRET_CANARY.json'), clean);
    const named = run('--root', root, '--input', 'token-SYNTHETIC_SECRET_CANARY.json', '--out', 'out');
    assert.equal(named.status, 0);
    assert.equal((named.stdout + named.stderr).includes('SYNTHETIC_SECRET_CANARY'), false);
    rmSync(join(root, 'out'), { recursive: true, force: true });
    mkdirSync(join(root, 'out'));
    symlinkSync(join(outside, 'config.json'), join(root, 'alias.json'));
    const escaped = run('--root', root, '--input', 'alias.json', '--out', 'out');
    assert.equal(escaped.status, 2);
    assert.equal(JSON.parse(escaped.stdout).status, 'incomplete');
    assert.deepEqual(readdirSync(join(root, 'out')), []);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('real CLI refuses all pre-existing output and preserves protected bytes', () => {
  for (const kind of ['unrelated', 'symlink', 'hardlink']) {
    const root = setup();
    try {
      const destination = join(root, 'out', kind === 'unrelated' ? 'unrelated.txt' : 'groups.json');
      if (kind === 'unrelated') writeFileSync(destination, 'unrelated');
      else if (kind === 'symlink') symlinkSync(join(root, 'config.json'), destination);
      else linkSync(join(root, 'config.json'), destination);
      const before = readFileSync(join(root, 'config.json'));
      const child = run('--root', root, '--input', 'config.json', '--out', 'out');
      assert.equal(child.status, 2);
      assert.equal(JSON.parse(child.stdout).status, 'incomplete');
      assert.deepEqual(readFileSync(join(root, 'config.json')), before);
      assert.equal(readFileSync(destination, 'utf8'), kind === 'unrelated' ? 'unrelated' : before.toString());
      assert.equal(readdirSync(join(root, 'out')).includes('reset-manifest.json'), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('input byte ceiling accepts exactly N and refuses N plus one', () => {
  const root = setup();
  try {
    const text = clean.toString();
    writeFileSync(join(root, 'config.json'), text + ' '.repeat(1048576 - Buffer.byteLength(text)));
    let child = run('--root', root, '--input', 'config.json', '--out', 'out');
    assert.equal(child.status, 0, child.stderr);
    rmSync(join(root, 'out'), { recursive: true, force: true });
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'config.json'), text + ' '.repeat(1048577 - Buffer.byteLength(text)));
    child = run('--root', root, '--input', 'config.json', '--out', 'out');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(item => item.ruleId), ['input-limit']);
    assert.deepEqual(readdirSync(join(root, 'out')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
