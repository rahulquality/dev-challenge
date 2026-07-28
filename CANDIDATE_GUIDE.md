# Candidate Guide — Firmware Release Publisher

This is a walkthrough of the task, the environment, and a recommended order of
work. It does **not** contain a solution — the design and code are yours to write.
For the precise, binding requirements always defer to [instruction.md](instruction.md);
this guide is the "how to approach it" companion.

---

## 1. The goal

Release engineering rotated the firmware **code-signing key**. Since the rotation,
every release bundle the old publisher submits to the distribution gateway is
rejected with `UNTRUSTED_SIGNATURE`, because bundles are still being signed with
the now-revoked key.

Your job is to (re)write the publisher so that it:

1. reads the raw build manifest and **reconciles** it (removes withdrawn builds and
   duplicate rows) using SQL in DuckDB;
2. **signs** each publishable release bundle with the key that is *currently* in
   force, using OpenSSL detached CMS signatures;
3. **submits** each signed bundle to the provided Express distribution gateway over
   HTTP;
4. **records** the gateway's receipts and its own idempotency tokens in DuckDB so a
   re-run does not double-publish; and
5. prints **deterministic** status lines that reproduce a golden reference file.

The one file you deliver is:

```
/app/publisher/release-publisher.mjs
```

It is run by the grader (and by you) via:

```
npm run report        # = node publisher/release-publisher.mjs --report
```

### What this exercise assesses
- SQL-based data reconciliation over an embedded database (DuckDB).
- Correct use of a cryptographic CLI (OpenSSL CMS) and understanding of key
  rotation / trust.
- HTTP integration against a real service, including idempotency.
- Local persistence and deterministic, reproducible output.

---

## 2. The environment (what is given to you)

Everything lives under `/app` inside the container:

| Path | What it is |
| --- | --- |
| `fixtures/build_manifest.csv` | The raw input you must reconcile. |
| `reports/publications.expected.txt` | The golden output your program must reproduce. |
| `package.json` | Defines `npm run report` and the `duckdb` dependency (installed for you). |
| `distribution-gateway/` | The provided Express service. **Do not modify it.** |
| `keys/current/` | The signing keypair currently in force (`current.key.pem`, `current.cert.pem`). |
| `keys/revoked/` | The old, rotated-out keypair. Signing with it fails — do not use it. |
| `publisher/` | **Empty — this is where your `release-publisher.mjs` goes.** |

You create `releases.duckdb` at run time; it is not pre-created.

### The manifest schema

```
entry_id,bundle_id,component_id,version,size_bytes,record_type,supersedes_id,recorded_at
```

- `record_type` is `BUILD` or `WITHDRAWAL`.
- A `WITHDRAWAL` row's `supersedes_id` is the `entry_id` of the `BUILD` it cancels.

### The gateway contract

Base URL `http://127.0.0.1:7070`.

- `GET /v1/signing-key/current` → `{ key_id, algorithm, certificate_ref, status }`
  — tells you which key id to report and which algorithm to sign with.
- `POST /v1/publications` with
  `{ descriptor, signature, request_token }` →
  `{ publication_id, request_token, status: "PUBLISHED" }` on success, or
  `{ error: "UNTRUSTED_SIGNATURE" }` if the signature doesn't verify against the
  current certificate. Re-posting the same `request_token` replays the original
  receipt (no duplicate is created).

Read [distribution-gateway/README.md](environment/distribution-gateway/README.md)
for the exact verification command and payload rules.

---

## 3. The reconciliation rules

Derive the set of **publishable bundles** with SQL:

1. **Collapse exact duplicates.** Rows identical across *every* column are the same
   record emitted twice — count them once.
2. **Apply withdrawals.** A build referenced by a `WITHDRAWAL` (via `supersedes_id`)
   is cancelled and is not part of any release.
3. A bundle is **publishable** if, after 1 and 2, it still has at least one
   surviving build. A bundle whose every build was withdrawn is skipped entirely.

For each publishable bundle you'll also need the number of surviving builds and the
sum of their `size_bytes` (these go into the signed descriptor).

---

## 4. Recommended order of work

Work in small, testable increments rather than writing the whole pipeline at once.

**Step 0 — Orient.**
Read [instruction.md](instruction.md), skim the gateway `README.md`, and start the
gateway in a second terminal so you can hit it while developing:

```
cd /app/distribution-gateway && node server.js
# then, in another shell:
curl -s http://127.0.0.1:7070/healthz
curl -s http://127.0.0.1:7070/v1/signing-key/current
```

**Step 1 — Ingest + reconcile.**
Load `fixtures/build_manifest.csv` into `releases.duckdb` and write the SQL that
produces `(bundle_id, artifact_count, total_bytes)` for each publishable bundle.
Print the rows and sanity-check them by hand against the CSV before moving on.

**Step 2 — Prove signing works, in isolation.**
Before wiring it into the program, confirm you can produce a signature the gateway
accepts. Build one canonical descriptor string and sign it:

```
printf '%s' '{"artifact_count":1,"bundle_id":"BND-TEST","total_bytes":100}' > /tmp/d.bin
openssl cms -sign -in /tmp/d.bin \
  -signer /app/keys/current/current.cert.pem \
  -inkey  /app/keys/current/current.key.pem \
  -outform PEM -binary > /tmp/sig.pem
```

Then POST `{descriptor, signature, request_token}` and confirm you get
`STATUS: PUBLISHED`. Try the same with the `keys/revoked/` key and confirm you get
`UNTRUSTED_SIGNATURE` — this is the trap the task is built around.

> ⚠️ **Canonicalization matters.** The bytes you sign must be *exactly* the bytes
> you send as `descriptor`. Use UTF-8 JSON with keys sorted lexicographically and
> no extra whitespace. If the signed bytes and the sent bytes differ by even one
> character, verification fails.

**Step 3 — Wire the loop.**
For each publishable bundle (in ascending `bundle_id` order): build the descriptor,
sign it, POST it, capture the receipt.

**Step 4 — Persist + idempotency.**
Store each `request_token`, its `publication_id`, and enough state in
`releases.duckdb` that a second run reuses the stored receipts instead of
re-submitting. Use the deterministic token `token-<bundle_id>`.

**Step 5 — Deterministic output.**
Emit exactly two lines per publishable bundle, ordered by `bundle_id`:

```
BUNDLE <bundle_id> SIGNED KEY=<key_id>
BUNDLE <bundle_id> PUBLISHED RECEIPT=<publication_id> TOKEN=<request_token> STATUS=PUBLISHED
```

`<key_id>` is whatever `GET /v1/signing-key/current` returns.

---

## 5. How to check yourself

**Reproduce the golden output** (the grader masks only the random `RECEIPT` value):

```
npm run report > /tmp/out.txt
diff <(sed -E 's/RECEIPT=[^ ]+/RECEIPT=<id>/' reports/publications.expected.txt) \
     <(sed -E 's/RECEIPT=[^ ]+/RECEIPT=<id>/' /tmp/out.txt)
# no diff  ->  output matches
```

**Confirm idempotency** — run it twice; the output must be byte-identical and the
gateway must still hold exactly one publication per bundle:

```
npm run report > /tmp/a.txt
npm run report > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt        # must be empty
```

**Sanity-check the provided gateway** (it is already correct; useful if you suspect
your own request shape):

```
cd /app/distribution-gateway && node --test tests/
```

---

## 6. Definition of done

- `npm run report` reproduces `reports/publications.expected.txt` (receipt masked),
  in the right order.
- The reconciled, publishable bundle set is correct (fully-withdrawn bundles and
  duplicate rows handled).
- Every submission is `PUBLISHED` — nothing is `UNTRUSTED_SIGNATURE` (you signed
  with the current key).
- `releases.duckdb` contains the receipts and request tokens you used.
- Re-running produces identical output and no duplicate publications on the gateway.

---

## 7. Boundaries (things that will fail you)

- Interact with the gateway **only over HTTP**. Do not read or write its private
  ledger at `distribution-gateway/data/gateway.json`.
- Do **not** disable or bypass signature verification.
- Do **not** sign with the revoked key.
- Do **not** hardcode the golden text, receipt ids, or row counts — your program
  must derive everything from the manifest, so it would still be correct if the
  manifest changed.
- Keep output ordering deterministic (sort by `bundle_id`).
