# Local Fixture Seeder

An offline, zero-dependency fixture generator for tests that need small related
JSON records. It makes synthetic groups and items from an explicit numeric seed,
then records the generated files and their hashes in a reset **manifest**. The
manifest helps a person inspect what was created; this tool never resets,
deletes, connects to a database, or edits existing data.

## Quick start

Use a separate, already existing, empty directory under the declared root.
From this repository:

```sh
fixture_root=$(mktemp -d)
cp examples/clean/config.json "$fixture_root/config.json"
mkdir "$fixture_root/out"
node bin/local-fixture-seeder.mjs --root "$fixture_root" --input config.json --out out
```

The command prints one JSON report to stdout and a short human summary to
stderr. It creates `groups.json`, `items.json`, then `reset-manifest.json` in
`out`. The two data files are deterministic for the same seed and profile,
including seed 0. Every item refers to a generated group. `--json` suppresses
the human summary. `--help` prints usage.

The [failing example](examples/failing/config.json) asks for 33 groups, one
beyond the supported ceiling. Run it in a fresh empty output directory in the
same way; it exits 2 with an incomplete report and writes nothing.

## Saved configuration

The input is UTF-8 JSON with exactly these four fields:

```json
{"schemaVersion":1,"seed":0,"groups":2,"itemsPerGroup":2}
```

`seed` is a canonical unsigned integer from 0 through 4294967295. `groups`
and `itemsPerGroup` are canonical positive integers. Decimal, exponent,
negative, duplicate-key, and unknown-field spellings are unsupported; they
never silently become a valid profile. The generator uses a specified 32-bit
xorshift sequence with an ordinal in every ID. It is reproducible, not
cryptographic randomness. Do not use real personal data or secrets as input.

## Rules and outcomes

| Rule | Observation | Outcome |
| --- | --- | --- |
| `input-invalid` | Missing, unknown or unsupported profile field | incomplete / 2 |
| `input-limit` | Input bytes or requested records exceed a limit | incomplete / 2 |
| `analysis-timeout` | Injected analysis clock exceeds the deadline | incomplete / 2 |
| `input-unreadable` | Named input cannot be read, decoded or parsed | incomplete / 2 |
| `input-unsafe` | Named input path is a symlink or leaves root | incomplete / 2 |
| `output-unsafe` | Output directory is not a real confined directory | incomplete / 2 |
| `output-not-empty` | Explicit output directory already has entries | incomplete / 2 |
| `write-refused` | A generated target aliases a path the run inspected | incomplete / 2 |
| `write-failed` | A file could not be exclusively created or completed | incomplete / 2 |

A complete generation is `pass` / exit 0 with a nonzero `summary.checked`.
There is no destructive policy operation to produce a valid-input `fail` / exit
1; the code is reserved by the catalog report contract. Invalid CLI usage,
unknown options and invalid root configuration exit 2 with **empty stdout** and
a fixed stderr diagnostic. A named unreadable input or refused write exits 2
with an `incomplete` JSON report. Findings use the logical file label `input`;
neither absolute paths nor untrusted values appear in report messages.

## Limits and safety

The input ceiling is 1 MiB, JSON depth 16 and JSON nodes 100. At most 32
groups, 32 items per group, and 512 total items are generated. The injected
analysis deadline defaults to 2000 ms; library callers can lower it and must
provide a finite nondecreasing clock. Every bound is tested at N and N+1.

The output directory must already exist, be empty, and resolve inside the real
root. Destinations are checked for symlinks, symlinked-parent escape, hard-link
identity to inspected inputs, and dangling named-input aliases before writing.
Files are opened with exclusive creation and no-follow flags. An existing
unrelated file is never removed or overwritten. A failed/interrupted write may
leave data files and even a partially written manifest filename. The report is
incomplete, and the manifest must parse and match the actual hashes before it
can be treated as a complete inventory. Inspect the directory and choose a
fresh empty destination rather than treating a partial run as a reset list.
As with any path preflight, this does not defend against a hostile
process concurrently replacing parent directories between checks and opens.

## Non-goals and development

This is not a database seeder, live data anonymizer, production reset tool,
deletion assistant, network client, or action planner. It creates only the
three documented files in the explicit destination. No runtime or development
dependencies are installed. `npm run check` runs syntax checks and tests under
active network denial.
