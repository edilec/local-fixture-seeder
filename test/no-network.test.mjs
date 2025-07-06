import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('active denial blocks a safe data URL without contacting a host', () => {
  assert.throws(() => fetch('data:text/plain,probe'), /network forbidden by test guard/u);
});

test('product source has no network, subprocess or destructive reset entry points', () => {
  const paths = ['src/index.mjs', 'src/json.mjs', 'src/write-guard.mjs', 'src/write.mjs', 'bin/local-fixture-seeder.mjs'];
  const source = paths.map(path => readFileSync(resolve(path), 'utf8')).join('\n');
  const forbidden = /(?:\bfetch\s*\(|\bcreateServer\s*\(|\bspawn\s*\(|\bexecFile\s*\(|\brm\s*\(|\bunlink\s*\(|\bconnect\s*\(|from\s+['"]node:(?:net|http|https|dns|tls|child_process)['"])/u;
  assert.equal(forbidden.test(source), false);
  assert.equal(forbidden.test('fetch("data:text/plain,probe")'), true);
});
