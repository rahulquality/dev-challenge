# Completion Plan — implement-an-openssl-signed-firmware-release-publisher-for-express-001

- **Task type:** `single_step`
- **Schema version:** 1

## Original Task

### Description

Release bundles are being rejected with UNTRUSTED_SIGNATURE after release
engineering rotated the firmware code-signing key. A JavaScript background
publisher must import the build manifest CSV into DuckDB, reconcile withdrawn
builds and duplicate manifest rows with SQL, sign canonical release descriptors
using OpenSSL, and submit them to the included Express distribution gateway. The
publisher records gateway receipts and request tokens in the database, then emits
deterministic status lines that are checked against CLI output snapshots.

Instruction sketch:
Implement `publisher/release-publisher.mjs` from the written spec. The publisher
must load `fixtures/build_manifest.csv` into `releases.duckdb`, use SQL to derive
publishable bundles, fetch signing metadata from the provided Express gateway,
create detached OpenSSL CMS signatures with the current PEM keypair, POST signed
descriptors to `/v1/publications`, persist receipts and retry state in DuckDB, and
make `npm run report` match the expected CLI output. Do not read or modify the
gateway ledger directly, do not bypass signature verification, and keep output
ordering deterministic.

Target languages: JavaScript, SQL.

External code provided: A provided Express.js distribution gateway contains
endpoints for signing-key metadata and publication submission, plus OpenSSL-based
signature verification and fixture responses for the current and revoked signing
keys.

### Metadata

- **OS:** linux
- **Build timeout (s):** 600
- **Run timeout (s):** 300
- **Emit process rubric:** False

## Components

### task.toml — Generated

- **Reference:** <https://www.harborframework.com/docs/tasks>

**Produced files:**

- `task.toml`

**Acceptance criteria:**

- [ ] Harbor loads the task without errors.
- [ ] Declared [environment].os=linux matches the files under environment/.
- [ ] [verifier].environment_mode=shared matches scaffold_plan.verifier.mode.

### instruction.md — Generated

- **Reference:** <https://www.harborframework.com/docs/tasks>

**Produced files:**

- `instruction.md`

**Acceptance criteria:**

- [ ] Following the instruction makes tests/test.sh exit zero.
- [ ] Every output/artifact path the tests read (releases.duckdb,
      reports/publications.expected.txt) is named in the instruction.
- [ ] The canonical descriptor format and CMS signing parameters are stated
      unambiguously so a correct signature verifies against the gateway.
- [ ] The two open questions (duplicate key, withdrawal rule) are resolved in the
      instruction text.

### environment/ — Partial

- **Reference:** <https://www.harborframework.com/docs/tasks>

**Produced files:**

- `environment/.dockerignore`
- `environment/.gitignore`
- `environment/Dockerfile`
- `environment/fixtures/build_manifest.csv`
- `environment/package.json`
- `environment/reports/publications.expected.txt`
- `environment/distribution-gateway/.gitignore`
- `environment/distribution-gateway/README.md`
- `environment/distribution-gateway/app.js`
- `environment/distribution-gateway/data/.gitkeep`
- `environment/distribution-gateway/fixtures/current-key.json`
- `environment/distribution-gateway/fixtures/revoked-key.json`
- `environment/distribution-gateway/lib/config.js`
- `environment/distribution-gateway/lib/signature-verify.js`
- `environment/distribution-gateway/lib/publication-store.js`
- `environment/distribution-gateway/package.json`
- `environment/distribution-gateway/routes/publications.js`
- `environment/distribution-gateway/routes/signing-key.js`
- `environment/distribution-gateway/server.js`
- `environment/distribution-gateway/tests/publications.test.js`

**Acceptance criteria:**

- [ ] docker build succeeds against environment/Dockerfile within the 600s build timeout.
- [ ] The gateway starts with `node server.js` on port 7070 inside the built container.
- [ ] `openssl cms -verify` against the current certificate succeeds for a
      current-key signature and fails for a revoked-key signature.
- [ ] tests/test.sh runs inside the built container without environment errors.
- [ ] The gateway's internal tests (node --test distribution-gateway/tests/) pass
      on the shipped, bug-free gateway.

### tests/ — Generated

- **Reference:** <https://www.harborframework.com/docs/tasks>

**Produced files:**

- `tests/test.sh`
- `tests/test_outputs.py`

**Acceptance criteria:**

- [ ] Tests fail on a naive publisher that signs with the revoked key
      (UNTRUSTED_SIGNATURE) or skips reconciliation.
- [ ] Tests pass on a correct publisher that reconciles, signs with the current
      key, submits, and persists receipts.
- [ ] Verifier applies a binary 0/1 reward only.
- [ ] Verifier runs identical logic for the oracle and the candidate.
- [ ] No test asserts a bundle ordering beyond the deterministic ordering the
      instruction requires.

**Open questions:**

- Which columns constitute a 'duplicate manifest row' that must be collapsed during
  reconciliation (identical (entry_id) vs. identical across every column)? Only the
  exact-across-all-columns invariant is graded.
- What is the exact rule by which a withdrawal cancels a prior build — supersede by
  entry_id, must sizes/versions match, are partial withdrawals possible? Only the
  bundle-membership invariant is graded.

### solution — Missing

- **Reference:** <https://www.harborframework.com/docs/tasks>

**Produced files:** _none_ (a stub entrypoint `solution/publish.sh` exists; the
reference publisher is authored and graded separately by a human and is NOT
included here.)

**Acceptance criteria:**

- [ ] A reference publisher run in the built container makes tests/test.sh exit zero.
- [ ] The reference solution signs with the current key so no submission is
      rejected as UNTRUSTED_SIGNATURE.
