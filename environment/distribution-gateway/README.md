# distribution-gateway

An Express service that publishes the current firmware code-signing key metadata
and accepts CMS-signed release descriptors from the publisher.

## Endpoints

- `GET /v1/signing-key/current` — returns the current signing-key metadata
  (`key_id`, `algorithm`, `certificate_ref`, `status`). Clients read this to learn
  which key and algorithm they must sign release descriptors with.
- `POST /v1/publications` — accepts a JSON body:

  ```json
  {
    "descriptor": "<canonical release descriptor>",
    "signature": "<detached CMS signature, PEM>",
    "request_token": "<client-supplied token>"
  }
  ```

  The gateway verifies the detached CMS signature over the exact descriptor bytes
  it received against the current certificate. On success it records the
  publication and returns a receipt `{ publication_id, request_token, status:
  "PUBLISHED" }`. A descriptor signed with the revoked key does not verify against
  the current certificate and is rejected with `{ "error": "UNTRUSTED_SIGNATURE" }`;
  nothing is recorded in that case. Re-posting with a request token that was
  already published replays the original receipt without creating a second
  publication.

## Canonical release descriptor

The descriptor is UTF-8 JSON with lexicographically sorted object keys and no
insignificant whitespace. The signer and the gateway must agree on these exact
bytes. The gateway verifies the bytes it received verbatim; when a caller submits
the descriptor as a structured object it is re-canonicalized the same way before
verification.

## Signature verification

Verification shells out to the OpenSSL CLI:

```
openssl cms -verify -inform PEM -in <sig.pem> -content <descriptor.bin> \
  -certfile $CURRENT_CERT_PATH -CAfile $CURRENT_CERT_PATH \
  -purpose any -no_check_time -binary
```

The current certificate is self-signed, so it is both the signer-certificate
source and the trust anchor. `CURRENT_CERT_PATH` defaults to
`/app/keys/current/current.cert.pem` (the build-time install location) and is
overridable so the gateway can run and be tested outside the container.

## Persistence

Published bundles are recorded internally under `data/` (created at runtime),
keyed by publication id and indexed by request token. This ledger is not exposed
over HTTP; publication state is observable only through the endpoints above.

## Running

```
node server.js        # listens on port 7070 (override with PORT)
```

## Tests

```
node --test tests/    # requires Node >= 18; mints ephemeral keys via openssl
```
