# Originality Note

**For the author's records. This is not a legal opinion.** The task in this folder
was regenerated independently from an abstract pattern skeleton (see
`_skeleton.md`); it was not copied, paraphrased, or find-and-replaced from the
source task. Names, domain, story, schemas, code, routes, ports, and data were all
invented fresh for a new domain. A formal legal review is still recommended before
any external use.

## New domain

**Firmware release publishing for an IoT device fleet.** A release-engineering
team rotated its code-signing key; a background *publisher* must reconcile a build
manifest, sign each publishable *release bundle* with the current key, submit it to
a *distribution gateway*, and record what it published. The gateway rejects
anything signed with the old (revoked) key.

This domain shares no vocabulary with the source (which was set in a financial
treasury / settlement-payout domain).

## Abstract concept → realization in this task

| Abstract skeleton element | How it is realized here |
| --- | --- |
| Candidate-authored worker module | `publisher/release-publisher.mjs` (ESM, Node 20) |
| CLI entry point + run verb | `npm run report` → `--report` |
| Delimited input fixture | `fixtures/build_manifest.csv` |
| Grouping entity | release *bundle* (`bundle_id`, e.g. `BND-101`) |
| Line-item record | build/withdrawal *entry* (`entry_id`, e.g. `MFR-0001`) |
| "Cancellation" record type | `WITHDRAWAL` rows referencing a build via `supersedes_id` |
| Normal record type | `BUILD` rows |
| Exact-duplicate rows | three byte-identical `BUILD` rows repeated in the CSV |
| Group that nets to nothing | `BND-104` — every build withdrawn, so it is dropped |
| Embedded analytical DB | DuckDB file `releases.duckdb` created at run time |
| Provided HTTP service | Express `distribution-gateway/` on port `7070` |
| Metadata GET endpoint | `GET /v1/signing-key/current` |
| Submission POST endpoint | `POST /v1/publications` |
| Signed canonical payload | release *descriptor* `{artifact_count, bundle_id, total_bytes}` |
| Crypto CLI + signature type | `openssl cms -sign` / `-verify`, detached CMS, PEM |
| Valid vs invalid key | `keys/current/` vs `keys/revoked/` (built at image time) |
| Key-metadata fixtures | `fixtures/current-key.json`, `fixtures/revoked-key.json` |
| Rejection error code | `UNTRUSTED_SIGNATURE` |
| Success status | `PUBLISHED` |
| Server receipt id | `publication_id` (randomized per accept) |
| Client idempotency token | `request_token` = `token-<bundle_id>` |
| Golden output file | `reports/publications.expected.txt` |
| Masked non-deterministic field | `RECEIPT=<publication_id>` |
| Gateway private store | `distribution-gateway/data/gateway.json` (HTTP-only, off-limits) |
| Verifier entry + reward | `tests/test.sh` → `/logs/verifier/reward.txt` (binary 0/1) |
| Verifier assertions | `tests/test_outputs.py` (pytest) |
| Service self-tests | `distribution-gateway/tests/publications.test.js` (node --test) |
| Solution entry point (stub only) | `solution/publish.sh` (no real solution inside) |

## Difficulty devices carried over (described abstractly)

1. **Wrong-key trap** — an old/revoked keypair is present and reproduces the
   production failure; only the current key verifies. Graded on both an accept path
   and an independent reject path.
2. **Exact byte canonicalization** — signed bytes and verified bytes must match
   (sorted keys, no insignificant whitespace) or the signature fails.
3. **Reconciliation semantics** — cancellation records remove their referenced
   record; a group with everything cancelled disappears; exact-duplicate rows
   collapse.
4. **Idempotency** — a second run must be byte-identical and must not create
   duplicate server-side rows; the service's own store is the ground truth.
5. **Determinism** — output ordering is fixed (sorted by group id); one
   non-deterministic server field is masked rather than pinned.
6. **Boundary rules** — HTTP-only interaction with the service; no reading its
   private store; no bypassing verification.
7. **Deferred sub-aspect** — one reconciliation sub-question (exact per-group
   totals) is left as a skipped test because its precise rule is an open question;
   only the group-membership invariant is binding.

## What I changed vs. what I kept

- **Changed:** the entire domain and narrative, every identifier (files,
  functions, classes, routes, columns, error codes, statuses, ports, key ids,
  sample data), the CSV schema, the signed-payload shape, and the code structure
  and idioms (e.g. the gateway verify path uses `execFileSync` with a
  try/catch rather than the source's inspect-status style; store/ledger method
  names and internal state shape differ).
- **Kept (abstract only):** the task type (build-from-spec), the skill set, the
  step count and shape, the difficulty devices above, and the verification style
  (background service + pytest + golden diff + independent recomputation + binary
  reward).
- **Not included:** no reference solution. `solution/publish.sh` is a stub that
  exits 0, matching the source's stub; the real solution is handled separately by
  the human grader.
