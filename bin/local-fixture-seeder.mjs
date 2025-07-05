#!/usr/bin/env node
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { buildFixtureSet, ConfigError, incompleteReport } from '../src/index.mjs';
import { parseFixtureJson } from '../src/json.mjs';
import { writeFixtureSet, WriteError } from '../src/write.mjs';

const MAX_BYTES = 1048576;
const USAGE = 'Usage: local-fixture-seeder --root DIR --input FILE --out DIR [--json]\n';

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--json' && !Object.hasOwn(options, 'json')) { options.json = true; continue; }
    if (['--root', '--input', '--out'].includes(flag) && !Object.hasOwn(options, flag.slice(2))
        && index + 1 < args.length && !args[index + 1].startsWith('--')) {
      options[flag.slice(2)] = args[++index];
      continue;
    }
    throw new ConfigError('Invalid CLI configuration.');
  }
  if (!options.root || !options.input || !options.out) throw new ConfigError('Invalid CLI configuration.');
  return options;
}

function inside(base, path) {
  const prefix = base.endsWith(sep) ? base : base + sep;
  return path === base || path.startsWith(prefix);
}

function emit(report, jsonOnly) {
  process.stdout.write(JSON.stringify(report) + '\n');
  if (!jsonOnly) process.stderr.write(`${report.status}: ${report.summary.checked} records, ${report.summary.written ?? 0} files\n`);
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch { process.stderr.write('Invalid CLI configuration.\n'); return 2; }
  if (options.help) { process.stdout.write(USAGE); return 0; }
  const root = resolve(options.root);
  let rootReal;
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Not a real directory.');
    rootReal = await realpath(root);
  } catch { process.stderr.write('Invalid CLI configuration.\n'); return 2; }

  const input = resolve(root, options.input);
  let inputReal;
  try {
    const named = await lstat(input);
    if (named.isSymbolicLink()) return emit(incompleteReport('input-unsafe'), options.json);
    if (!named.isFile()) return emit(incompleteReport('input-unreadable'), options.json);
    inputReal = await realpath(input);
    if (!inside(rootReal, inputReal)) return emit(incompleteReport('input-unsafe'), options.json);
    if (named.size > MAX_BYTES) return emit(incompleteReport('input-limit', '/limits/maxBytes'), options.json);
  } catch { return emit(incompleteReport('input-unreadable'), options.json); }

  let profile;
  try {
    const bytes = await readFile(input);
    if (bytes.length > MAX_BYTES) return emit(incompleteReport('input-limit', '/limits/maxBytes'), options.json);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    profile = parseFixtureJson(text);
  } catch { return emit(incompleteReport('input-unreadable'), options.json); }

  let built;
  try { built = buildFixtureSet(profile); }
  catch (error) {
    if (error instanceof ConfigError) { process.stderr.write('Invalid CLI configuration.\n'); return 2; }
    return emit(incompleteReport('input-invalid'), options.json);
  }
  if (built.report.status !== 'pass') return emit(built.report, options.json);

  try {
    const written = await writeFixtureSet({ root, input, out: resolve(root, options.out), artifacts: built.artifacts });
    built.report.summary.written = written.length;
    return emit(built.report, options.json);
  } catch (error) {
    if (error instanceof WriteError) {
      const report = incompleteReport(error.ruleId, '', built.report.summary.checked);
      report.summary.written = error.written.length;
      return emit(report, options.json);
    }
    return emit(incompleteReport('write-failed', '', built.report.summary.checked), options.json);
  }
}

process.exitCode = await main();
