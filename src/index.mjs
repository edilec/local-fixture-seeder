import { createHash } from 'node:crypto';

export const TOOL_ID = 'local-fixture-seeder';
export const DEFAULT_LIMITS = Object.freeze({
  maxGroups: 32,
  maxItemsPerGroup: 32,
  maxItems: 512,
  timeoutMs: 2000,
});
export const RULE_SEVERITY = Object.freeze({
  'input-invalid': 'warning',
  'input-limit': 'warning',
  'analysis-timeout': 'warning',
  'input-unreadable': 'warning',
  'input-unsafe': 'warning',
  'output-unsafe': 'warning',
  'output-not-empty': 'warning',
  'write-refused': 'warning',
  'write-failed': 'warning',
});

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; }
}

function finding(ruleId, pointer = '') {
  if (!Object.hasOwn(RULE_SEVERITY, ruleId)) throw new Error('Unknown rule.');
  const messages = {
    'input-invalid': 'Saved fixture configuration has an unsupported or missing field.',
    'input-limit': 'Saved fixture configuration exceeds a supported limit.',
    'analysis-timeout': 'Fixture generation exceeded its analysis deadline.',
    'input-unreadable': 'Named fixture configuration could not be read or parsed.',
    'input-unsafe': 'Named fixture configuration has unsafe provenance.',
    'output-unsafe': 'Named output directory has unsafe provenance.',
    'output-not-empty': 'Named output directory is not empty; no generated file was written.',
    'write-refused': 'A generated destination is not safe to create.',
    'write-failed': 'Generated files could not all be created; inspect the output directory.',
  };
  return {
    ruleId,
    severity: RULE_SEVERITY[ruleId],
    message: messages[ruleId],
    location: { file: 'input', ...(pointer ? { pointer } : {}) },
  };
}

export function incompleteReport(ruleId, pointer = '', checked = 0) {
  return {
    schemaVersion: '1', tool: TOOL_ID, status: 'incomplete',
    summary: { checked, errors: 0, warnings: 1 },
    findings: [finding(ruleId, pointer)],
  };
}

function limitsFrom(value) {
  if (value === undefined) return DEFAULT_LIMITS;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ConfigError('Invalid analysis limits.');
  let keys;
  let descriptors;
  try {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Nonplain limits.');
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { throw new ConfigError('Invalid analysis limits.'); }
  const limits = { ...DEFAULT_LIMITS };
  for (const key of keys) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) throw new ConfigError('Unknown analysis limit.');
    if (!Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) throw new ConfigError('Invalid analysis limit.');
    const maximum = key === 'timeoutMs' ? 60000 : DEFAULT_LIMITS[key];
    const item = descriptors[key].value;
    if (!Number.isSafeInteger(item) || item < 1 || item > maximum) {
      throw new ConfigError('Invalid analysis limit.');
    }
    limits[key] = item;
  }
  return limits;
}

function snapshotProfile(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 4 || keys.some(key => typeof key !== 'string')) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) return null;
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  } catch { return null; }
}

function profileCheck(profile, limits) {
  try {
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) return ['input-invalid', ''];
    const keys = Object.keys(profile);
    if (keys.length !== 4 || keys.some(key => !['schemaVersion', 'seed', 'groups', 'itemsPerGroup'].includes(key))) {
      return ['input-invalid', ''];
    }
    if (profile.schemaVersion !== 1 || !Number.isSafeInteger(profile.seed) || profile.seed < 0 || profile.seed > 4294967295) {
      return ['input-invalid', '/seed'];
    }
    if (!Number.isSafeInteger(profile.groups) || profile.groups < 1) return ['input-invalid', '/groups'];
    if (!Number.isSafeInteger(profile.itemsPerGroup) || profile.itemsPerGroup < 1) return ['input-invalid', '/itemsPerGroup'];
    if (profile.groups > limits.maxGroups) return ['input-limit', '/groups'];
    if (profile.itemsPerGroup > limits.maxItemsPerGroup) return ['input-limit', '/itemsPerGroup'];
    if (profile.groups * profile.itemsPerGroup > limits.maxItems) return ['input-limit', '/itemsPerGroup'];
    return null;
  } catch {
    return ['input-invalid', ''];
  }
}

function serial(value) { return JSON.stringify(value, null, 2) + '\n'; }
function sha256(bytes) { return createHash('sha256').update(bytes, 'utf8').digest('hex'); }
function generator(seed) {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}
function id(kind, ordinal, random) { return `${kind}-${String(ordinal).padStart(3, '0')}-${random.toString(16).padStart(8, '0')}`; }

/** Pure, offline fixture construction. Files are only written by the explicit CLI. */
export function buildFixtureSet(profile, options = {}) {
  let config;
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new Error('Nonplain options.');
    const keys = Reflect.ownKeys(options);
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (keys.some(key => !['now', 'limits'].includes(key)
        || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) throw new Error('Unknown option.');
    config = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  } catch { throw new ConfigError('Invalid generator options.'); }
  const limits = limitsFrom(config.limits);
  const now = config.now ?? Date.now;
  if (typeof now !== 'function') throw new ConfigError('Invalid analysis clock.');
  let previous;
  const readClock = () => {
    const value = now();
    if (typeof value !== 'number' || !Number.isFinite(value) || (previous !== undefined && value < previous)) {
      throw new ConfigError('Invalid analysis clock.');
    }
    previous = value;
    return value;
  };
  const start = readClock();
  const safeProfile = snapshotProfile(profile);
  const invalid = profileCheck(safeProfile, limits);
  if (invalid) return { report: incompleteReport(...invalid), artifacts: [] };
  const next = generator(safeProfile.seed);
  const groups = [];
  const items = [];
  const timedOut = () => readClock() - start > limits.timeoutMs;
  for (let groupIndex = 1; groupIndex <= safeProfile.groups; groupIndex++) {
    if (timedOut()) return { report: incompleteReport('analysis-timeout', '', groups.length + items.length), artifacts: [] };
    const groupId = id('group', groupIndex, next());
    groups.push({ id: groupId, label: `Synthetic group ${groupIndex}` });
    for (let itemIndex = 1; itemIndex <= safeProfile.itemsPerGroup; itemIndex++) {
      if (timedOut()) return { report: incompleteReport('analysis-timeout', '', groups.length + items.length), artifacts: [] };
      const ordinal = (groupIndex - 1) * safeProfile.itemsPerGroup + itemIndex;
      items.push({ id: id('item', ordinal, next()), groupId, label: `Synthetic item ${ordinal}` });
    }
  }
  if (timedOut()) return { report: incompleteReport('analysis-timeout', '', groups.length + items.length), artifacts: [] };
  const groupBytes = serial(groups);
  const itemBytes = serial(items);
  const manifest = {
    schemaVersion: 1,
    tool: TOOL_ID,
    artifacts: [
      { path: 'groups.json', records: groups.length, sha256: sha256(groupBytes) },
      { path: 'items.json', records: items.length, sha256: sha256(itemBytes) },
    ],
  };
  return {
    report: {
      schemaVersion: '1', tool: TOOL_ID, status: 'pass',
      summary: { checked: groups.length + items.length, errors: 0, warnings: 0,
        groups: groups.length, items: items.length },
      findings: [],
    },
    artifacts: [
      { name: 'groups.json', bytes: groupBytes },
      { name: 'items.json', bytes: itemBytes },
      { name: 'reset-manifest.json', bytes: serial(manifest) },
    ],
  };
}
