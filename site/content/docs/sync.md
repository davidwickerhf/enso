---
title: Sync & recovery
description: How end-to-end encrypted sync works, the recovery phrase, and what the server can and cannot see.
order: 21
group: Your data
---

# Sync & recovery

Sync keeps conversations, memory, profile, skills, settings and reports the same on every Mac you use. It is **optional** and **off by default**, and it is **end-to-end encrypted**: your data is encrypted on your Mac before it is uploaded, with a key the server never receives.

> **Status: preview.** The sync server described here is live. Turning sync on inside Ensō arrives with an upcoming helper release; until then nothing is uploaded.

## Turning it on

1. In **Settings → Sync**, enter your email address and a name for this Mac.
2. Ensō shows a short code, and we email you a sign-in link.
3. Open the link. The page shows the Mac's name and the same code. If they match, click **Approve**.
4. On your first Mac, Ensō creates your **account key** and shows your **recovery phrase**: 24 words. Write them down and keep them somewhere safe, offline.
5. On another Mac, after approving it, enter the 24 words once. Sync starts.

The account page at [enso.wicker.life/account](/account) lists your devices and storage, and lets you remove a device, export everything, or delete the account.

## Your key and recovery phrase

- When you first turn on sync, Ensō generates a random **256-bit account key** on your Mac and keeps it in the **macOS Keychain**.
- The **recovery phrase** is that same key written as 24 words (the BIP-39 English word list: 256 bits plus an 8-bit checksum). Anyone with the phrase can decrypt your data; nobody without it can, including us.
- **If you lose every Mac and the phrase, your synced data cannot be recovered.** We can't reset it, because we never had it. Your data on any remaining Mac is unaffected.

## What gets encrypted, and how

Everything is encrypted before upload, one item at a time:

- Each item (a conversation, your memory, a report, …) is encrypted with **XChaCha20-Poly1305** using a fresh random 24-byte nonce, under a key derived from your account key.
- Item **names** are not sent either. Each item is stored under a keyed hash of its name, so the server sees something like `p9Xk2…` instead of `conversations/flight-to-yerevan.jsonl`, and can't tell a conversation from a setting.
- Each ciphertext is bound to its hashed name, so the server can't swap two items without the change being detected.

The technical details, for anyone building a client or checking ours, are in the [Sync API](/docs/sync-api) reference.

## What the server can see

The server has to know some things to work. It stores:

- your **email address**, to sign you in;
- the **names you give your devices**, and when each was added and last used;
- for each item: its hashed name, its **size**, a version number, when it changed, and which device changed it;
- your total storage use;
- standard request logs (IP address, time, path, status) for security and debugging.

It never receives your account key, your recovery phrase, or any plaintext: no conversation text, titles, memory, page content or settings.

## Conflicts

Each item has a version. A Mac uploads a change only if the item is still at the version it last saw; if another Mac changed it in the meantime, the upload is refused and Ensō fetches the newer version, merges, and tries again. Changes are never silently overwritten.

## Limits

- **1 GB** of encrypted storage per account.
- **16 MB** per item.
- A few hundred requests per minute per device.

## Removing a Mac, or everything

- **Remove a device** on the account page: its access ends immediately. Its local data stays on that Mac.
- **Delete your account** on the account page: every item is deleted from storage at once, every device is signed out, and your email address is removed. Ensō keeps working locally on each Mac.
- **Export** first if you want a copy: it downloads every item, still encrypted, as one JSON file.
