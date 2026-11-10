---
title: Sync API
description: The encryption scheme Ensō clients use and the HTTP API of the zero-knowledge sync server.
order: 30
group: Reference
---

# Sync API

This page is for anyone building or auditing a sync client. The server is deliberately simple: it stores opaque blobs under opaque keys, with versions, quotas and per-device tokens. **All cryptography happens on the client.** The server never receives a key, a recovery phrase, or plaintext.

Base URL: `https://enso.wicker.life`. All responses are JSON unless noted. Errors look like `{"error": "version_conflict", ...}`.

## Client-side encryption

### Keys

| Name | Derivation | Purpose |
|---|---|---|
| `K` (account key) | 32 random bytes from a CSPRNG, made once on the first device | Root of everything; stored in the macOS Keychain (service `enso-sync`) |
| Recovery phrase | BIP-39 English mnemonic of `K` (256 bits + 8-bit checksum = 24 words) | Restores `K` on a new device |
| `K_enc` | `HKDF-SHA256(ikm=K, salt="enso-sync-v1", info="blob-encryption", L=32)` | Encrypts blob contents |
| `K_name` | `HKDF-SHA256(ikm=K, salt="enso-sync-v1", info="blob-names", L=32)` | Hashes blob names |

### Blob keys (names)

The logical name of an item, such as `conversations/2f1c….jsonl` or `memory.md`, is never sent. The client sends:

```text
key = base64url( HMAC-SHA256(K_name, utf8(logical_name)) )      // 43 characters, no padding
```

The server only checks that a key matches `[A-Za-z0-9._-]{1,128}`, so it can't tell what kind of item it holds. Clients keep their own index (itself an encrypted blob under the key derived from the name `index`) that maps logical names to metadata.

### Blob format

```text
blob = 0x01 || nonce (24 bytes) || ciphertext || tag (16 bytes)

nonce      = 24 random bytes, fresh for every write
plaintext  = pad( gzip(item) )
ciphertext, tag = XChaCha20-Poly1305(K_enc, nonce, plaintext, aad)
aad        = utf8("enso-blob-v1|") || utf8(key)
```

- The leading byte is the format version.
- Binding the hashed key into the AAD means the server can't serve one item's ciphertext in place of another's: decryption fails.
- `pad(x) = u32_be(len(x)) || x || zero bytes`, up to the next multiple of 4 KiB, so sizes reveal less.
- AES-256-GCM with a 12-byte random nonce is an acceptable alternative for a client that lacks XChaCha20 (format byte `0x02`); never reuse a nonce under the same key.

### Key check

On a new device, after the phrase is entered, the client fetches the blob for the name `keycheck` and decrypts it. Success proves the phrase is right before anything is written. The first device writes it when sync is turned on.

### What the server learns

Blob count, sizes (padded), version numbers, write times, which device wrote each blob, the account's email, device names, and request metadata (IP, time). Nothing else.

## Authentication

### Device sign-in (recommended)

```http
POST /api/device/start
Content-Type: application/json

{"email": "you@example.com", "deviceName": "MacBook Air"}
```

```json
{"deviceCode": "…", "userCode": "QX4M-7PRA", "expiresIn": 900, "interval": 3}
```

The server emails a magic link. Show `userCode` to the user; the link opens a page that shows the same code and asks them to approve the device. Then poll every `interval` seconds:

```http
POST /api/device/poll
Content-Type: application/json

{"deviceCode": "…"}
```

| Status | Body | Meaning |
|---|---|---|
| `202` | `{"status": "pending"}` | Not approved yet; keep polling |
| `200` | `{"status": "approved", "token": "enso_…", "device": {"id", "name"}}` | Store the token in the Keychain. It is returned **once** |
| `410` | `{"status": "denied"}` or `{"status": "expired"}` | Start again |

### Tokens

Send the device token on every sync request:

```http
Authorization: Bearer enso_9b1v…
```

Tokens are 256-bit random values; the server stores only their SHA-256. A token can also be created by hand on the account page.

## Blobs

### `PUT /api/sync/blobs/:key`

Body: the encrypted blob, `Content-Type: application/octet-stream`. One precondition header is **required**, so an update can never silently overwrite another device's change:

| Header | Meaning |
|---|---|
| `If-None-Match: *` | Create: succeeds only if no live blob exists under this key |
| `If-Match: "<version>"` | Update: succeeds only if the current version is exactly this |

| Status | Meaning |
|---|---|
| `201` / `200` | Created / updated. Body `{"key", "version", "size"}`, header `ETag: "<version>"` |
| `412` | `version_conflict`. Body has `currentVersion`; fetch, merge, retry with the new version |
| `428` | No precondition header was sent |
| `413` | Larger than the per-blob limit (default 16 MiB) |
| `507` | `quota_exceeded`. Body has `usedBytes` and `quotaBytes` |

Versions start at 1 and go up by one with every write or delete of that key.

### `GET /api/sync/blobs/:key`

Returns the bytes with `ETag: "<version>"`. Send `If-None-Match: "<version>"` to get `304 Not Modified` when you are up to date. `404` if there is no live blob.

### `DELETE /api/sync/blobs/:key`

Optional `If-Match: "<version>"`. Deletes the bytes and leaves a **tombstone** (with a new version) so other devices learn about the deletion. Tombstones are kept for 90 days. Returns `{"key", "version", "deleted": true}`.

### `GET /api/sync/manifest?since=<cursor>&limit=<n>`

Everything that changed after `since` (default `0`, meaning everything), oldest change first:

```json
{
  "entries": [
    {"key": "p9Xk…", "version": 4, "size": 8192, "deleted": false, "updatedAt": "2026-11-09T10:12:03.120Z", "seq": 1093}
  ],
  "cursor": 1093,
  "more": false,
  "usage": {"usedBytes": 1048576, "quotaBytes": 1073741824, "blobCount": 212}
}
```

Store `cursor` and pass it as `since` next time. If `more` is true, call again straight away. Writes within an account are serialised, so a cursor never skips a change.

### `GET /api/sync/usage`

`{"usedBytes", "quotaBytes", "blobCount"}`.

## Devices and account

| Request | Does |
|---|---|
| `GET /api/devices` | Lists the account's devices, marking the current one |
| `DELETE /api/devices/:id` | Revokes a device; its token stops working immediately |
| `DELETE /api/account` with `{"confirm": "delete"}` | Deletes the account, every blob and every device |

## Limits

| Limit | Default |
|---|---|
| Storage per account | 1 GiB |
| Size per blob | 16 MiB |
| Requests per device | 300 per minute (`429` with `Retry-After` beyond that) |
| Device sign-in starts | 5 per email and 10 per IP address per 15 minutes |
| Sign-in links | Valid 15 minutes, usable once |

## Other endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{"ok": true}` when the server and database are up |
| `GET /api/latest` | Latest extension and helper versions, with download URLs and SHA-256 |
| `GET /updates.json` | Firefox update manifest for the extension |
