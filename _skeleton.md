# Abstract Task Skeleton

Extracted from the input task in my own neutral words. This records ONLY the
reusable pattern — task type, skills, step count, difficulty devices, and file
layout — not any concrete text, names, or data from the source.

## Task type
- **Build / implement.** The candidate writes one program from a written spec.
  The surrounding environment (a small HTTP service, fixtures, key material,
  tests) is provided; the candidate's deliverable is a single worker module plus
  the runtime artifacts it produces.

## Skills exercised
1. **Data ingestion + SQL reconciliation.** Load a delimited flat file into an
   embedded analytical database and use SQL to derive a reduced, correct working
   set from messy raw rows.
2. **Cryptographic signing via a CLI tool.** Produce detached signatures over an
   exact canonical byte payload using a command-line crypto tool and a specific
   keypair; understand key rotation and why the wrong key fails verification.
3. **HTTP integration.** Read metadata from one endpoint, submit signed payloads
   to another, and interpret success/failure responses.
4. **Idempotency + persistence.** Persist server receipts and client-side
   dedup/idempotency tokens locally so a re-run does not duplicate server-side
   effects.
5. **Deterministic output.** Emit stable, ordered status lines that match a
   golden file byte-for-byte (modulo one intentionally-masked non-deterministic
   field).

## Inputs the candidate receives
- A ~40-row flat-file fixture containing grouped records, some of which are
  cancelled by later "reversal"-type rows and some of which are exact duplicates.
- A running HTTP service (multi-file, provided as environment code) exposing a
  metadata GET endpoint and a submission POST endpoint, with real signature
  verification middleware that shells out to the crypto CLI.
- Two keypairs generated at image build time: a current/valid one and a
  retired/invalid one, plus metadata fixtures describing each.
- A package manifest that pins the entry-point script name and the DB dependency.
- A golden output file to reproduce.

## Outputs the candidate must produce
- One worker/entry-point module (NOT shipped — the candidate authors it).
- An embedded DB file created at run time holding server receipts + idempotency
  tokens + retry state.
- Deterministic status lines on stdout that reproduce the golden file.

## Number & shape of steps
1. Import flat file → embedded DB.
2. SQL reconciliation: drop cancelled records, collapse exact duplicates, derive
   the set of "eligible groups."
3. For each eligible group: build a canonical payload, sign it with the CURRENT
   key via the crypto CLI, POST it with a deterministic idempotency token.
4. Persist the returned receipt + token + retry state into the DB.
5. Print deterministic, ordered status lines.

## Difficulty devices / traps
- **Wrong-key trap.** Signing with the retired key reproduces the production
  failure; only the current key verifies. Tests both accept-with-current and
  reject-with-retired paths independently of the worker's own stdout.
- **Exact byte canonicalization.** The signed bytes and the server's verified
  bytes must be identical (sorted keys, no insignificant whitespace) or the
  signature fails.
- **Reconciliation semantics.** A group whose every record is cancelled must NOT
  appear as eligible (nets to nothing). Exact-duplicate rows must collapse.
- **Idempotency.** A second run must be byte-identical output and must NOT create
  duplicate server-side rows; the server's own store is the ground truth.
- **Determinism.** Output ordering is fixed; one non-deterministic server field
  is masked by the verifier rather than pinned.
- **Boundary rules.** The worker may only touch the service over HTTP; it must
  not read/modify the service's private store, and must not bypass verification.

## Verification style
- A shell entry-point resets prior state, launches the provided service in the
  background on a fixed port, waits for readiness, then runs a pytest suite and
  writes a binary 0/1 reward file.
- The pytest suite: (a) diffs stdout against the golden (masking one field);
  (b) recomputes the eligible-group set independently from the raw fixture and
  compares; (c) drives verifier-owned signed requests through the real
  verification path with both keypairs; (d) reads the candidate's DB to confirm
  receipts/tokens are persisted; (e) re-runs to confirm idempotent replay and no
  duplicate server rows.
- One reconciliation sub-aspect (exact amount-level netting) is deliberately left
  as a skipped/deferred test because its precise semantics are an open question;
  only the group-membership invariant is binding.

## File layout (roles)
- `task.toml` — task metadata / environment limits.
- `instruction.md` — the agent-facing spec.
- `completion_plan.{md,yaml}`, `scaffold_plan.yaml` — authoring/planning records.
- `environment/Dockerfile` — builds the image, generates the two keypairs, installs
  deps.
- `environment/package.json` — pins the entry-point script + DB dependency.
- `environment/fixtures/<flatfile>` — the raw input records.
- `environment/reports|snapshots/<golden>` — the golden output.
- `environment/<service>/` — the provided multi-file HTTP service (server, app,
  routes, lib/verify + store + config, key-metadata fixtures, its own tests).
- `tests/test.sh` + `tests/test_outputs.py` — the verifier.
- `solution/<entrypoint>` — a stub only; the real reference solution is handled
  separately by a human and is NOT present.
