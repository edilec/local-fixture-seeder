# Local fixture seeder design

This tool reads one saved JSON configuration and writes only synthetic JSON files
to an explicitly named, existing, empty directory under a declared local root.
It never opens a database, contacts a host, edits its input, or runs a reset.

## Input and generated data

The version-1 profile has exactly `schemaVersion: 1`, `seed` (an unsigned
32-bit integer), `groups` (1–32), and `itemsPerGroup` (1–32). Unknown fields,
duplicate JSON keys, unsupported values, unreadable bytes, and exceeded limits
are incomplete evidence; an unknown CLI option or invalid analysis limit is an
invalid configuration. A finite monotone injected clock enforces the analysis
deadline. The input byte ceiling is 1 MiB.

Generation uses a specified 32-bit xorshift sequence, not runtime randomness.
Zero seed is mixed with a fixed nonzero constant, and every ID also includes a
stable numeric ordinal, so IDs stay unique even if the pseudo-random part
collides. Every item refers to one generated group ID, and every name is fixed
synthetic text. Record arrays are in numeric source order. The seed is not
emitted in the report.

`groups.json` and `items.json` end with one newline and are created exclusively.
`reset-manifest.json` is created last and contains the two relative artifact
names, their SHA-256 hashes, and record counts. The manifest is an inventory
for a human to inspect; it is not a deletion instruction or reset operation.
The CLI never deletes or replaces files. An interrupted write can leave a
partial directory with no manifest; the report is incomplete and the caller
must inspect it before retrying in a new empty directory.

## Paths and outcomes

The root must be an existing real directory. The input and output directory
must resolve within it. The input is never a symlink; the output directory and
each named destination are checked for symbolic links. Each target is also
checked for hard-link identity against all paths the run has inspected,
including the input, root, output directory and listed output entries. No
destination may already exist. A symlinked parent that resolves outside root
is refused. Output creation uses exclusive and no-follow flags.

The JSON report on stdout uses logical source label `input` and fixed artifact
names only, never an absolute host path or untrusted value. A successful run
has status `pass` and exit 0 with a nonzero checked count. Invalid CLI/root
configuration has empty stdout and exit 2. A named unreadable input or refused
write produces an `incomplete` JSON report and exit 2. stderr contains only a
fixed human summary unless `--json` is selected. The tool has no policy-fail
case for valid generation; exit 1 remains reserved for a future explicit
policy failure, never for a failed write.

## Implementation sequence

1. Pin clean deterministic and referential-integrity behavior with a red test.
2. Pin invalid/unknown profile, exact N and N+1 limits, injected clock, and
   deterministic report ordering.
3. Pin CLI stream shapes, confinement, safe write, and each alias shape.
   Direct guard tests must reach destination-symlink, parent-symlink, and
   hard-link branches; a product-level mutation must prove the writer calls
   the guard before creation despite the empty-directory precondition.
4. Pin active offline denial, docs and runnable examples.
5. Break every advertised guarantee in a disposable copy and observe red,
   then run the full offline check and commit a clean tree.
