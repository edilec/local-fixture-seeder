import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { assertWritableDestination, DestinationError } from './write-guard.mjs';

export class WriteError extends Error {
  constructor(ruleId, cause = null, written = []) {
    super('Fixture output could not be completed.', { cause });
    this.name = 'WriteError';
    this.ruleId = ruleId;
    this.written = [...written];
  }
}

const ARTIFACT_NAMES = Object.freeze(['groups.json', 'items.json', 'reset-manifest.json']);
function inside(base, path) {
  const prefix = base.endsWith(sep) ? base : base + sep;
  return path === base || path.startsWith(prefix);
}

/** Explicit creation only: all three destinations are preflighted, manifest last. */
export async function writeFixtureSet({ root, input, out, artifacts }) {
  if (!Array.isArray(artifacts) || artifacts.length !== 3
      || artifacts.some((item, index) => item?.name !== ARTIFACT_NAMES[index] || typeof item.bytes !== 'string')) {
    throw new WriteError('write-refused');
  }
  const resolvedRoot = resolve(root);
  const resolvedOut = resolve(out);
  let rootReal;
  let outReal;
  try {
    const outStat = await lstat(resolvedOut);
    if (!outStat.isDirectory() || outStat.isSymbolicLink()) throw new Error('Unsafe output directory.');
    rootReal = await realpath(resolvedRoot);
    outReal = await realpath(resolvedOut);
    if (!inside(rootReal, outReal)) throw new Error('Output directory escaped root.');
  } catch (error) { throw new WriteError('output-unsafe', error); }

  let entries;
  try { entries = await readdir(resolvedOut); }
  catch (error) { throw new WriteError('output-unsafe', error); }
  const inputs = [resolvedRoot, resolve(input), resolvedOut, ...entries.map(name => join(resolvedOut, name))];
  const targets = artifacts.map(item => join(resolvedOut, item.name));
  try {
    for (const target of targets) await assertWritableDestination(target, { root: rootReal, inputs, label: '--out' });
  } catch (error) {
    if (error instanceof DestinationError) throw new WriteError('write-refused', error);
    throw new WriteError('write-failed', error);
  }
  if (entries.length !== 0) throw new WriteError('output-not-empty');

  const written = [];
  for (let index = 0; index < targets.length; index++) {
    try {
      // The guard is repeated immediately before each exclusive open.
      await assertWritableDestination(targets[index], { root: rootReal, inputs, label: '--out' });
      const handle = await open(targets[index],
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(artifacts[index].bytes, 'utf8'); }
      finally { await handle.close(); }
      written.push(ARTIFACT_NAMES[index]);
    } catch (error) {
      throw new WriteError(error instanceof DestinationError ? 'write-refused' : 'write-failed', error, written);
    }
  }
  return written;
}
