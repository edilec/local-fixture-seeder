import { lstat, readlink, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';

/** Copied from the catalog write guard: destinations are checked before opening. */
export class DestinationError extends Error {
  constructor(message) { super(message); this.name = 'DestinationError'; }
}

async function namedInputTarget(path, label) {
  let current = resolve(path);
  const seen = new Set();
  for (let hop = 0; hop < 40; hop++) {
    let parent;
    try { parent = await realpath(dirname(current)); }
    catch (error) {
      if (error.code === 'ENOENT') return current;
      throw new DestinationError(`${label} input path could not be inspected.`);
    }
    const named = resolve(parent, basename(current));
    if (seen.has(named)) throw new DestinationError(`${label} input path has a symbolic-link cycle.`);
    seen.add(named);
    try { current = resolve(parent, await readlink(named)); }
    catch (error) {
      if (error.code === 'EINVAL' || error.code === 'ENOENT') return named;
      throw new DestinationError(`${label} input path could not be inspected.`);
    }
  }
  throw new DestinationError(`${label} input path has too many symbolic links.`);
}

/**
 * Refuse a destination symlink, parent escape, hard-link input alias, or
 * dangling named-input symlink alias. `inputs` includes every path inspected
 * or reasoned about, not only files opened for reading.
 */
export async function assertWritableDestination(destination, options = {}) {
  const { inputs = [], root = null, label = '--out' } = options;
  const target = resolve(destination);
  let existing = null;
  try { existing = await lstat(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new DestinationError(`${label} could not be inspected.`);
  }
  if (existing !== null && existing.isSymbolicLink()) throw new DestinationError(`${label} is a symbolic link.`);
  if (existing !== null && !existing.isFile()) throw new DestinationError(`${label} exists and is not a regular file.`);

  let parent;
  try { parent = await realpath(dirname(target)); }
  catch { throw new DestinationError(`${label} names a directory that does not exist.`); }
  if (root !== null) {
    let base;
    try { base = await realpath(resolve(root)); }
    catch { throw new DestinationError(`${label} root could not be inspected.`); }
    const prefix = base.endsWith(sep) ? base : base + sep;
    if (parent !== base && !parent.startsWith(prefix)) throw new DestinationError(`${label} is outside the permitted root.`);
  }

  const namedDestination = resolve(parent, basename(target));
  for (const input of inputs) {
    if (await namedInputTarget(input, label) === namedDestination) throw new DestinationError(`${label} names an input path.`);
  }
  if (existing === null) return target;
  for (const input of inputs) {
    let source;
    try { source = await stat(input); }
    catch { continue; }
    if (source.dev === existing.dev && source.ino === existing.ino) {
      throw new DestinationError(`${label} is the same file as an input.`);
    }
  }
  return target;
}
