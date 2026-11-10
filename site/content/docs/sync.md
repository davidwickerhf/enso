---
title: Sync & recovery
description: How end-to-end encrypted sync works, the recovery phrase, and what the server can and cannot see.
order: 21
group: Your data
---

# Sync & recovery

Sync keeps conversations, memory, profile, skills, settings and reports the same on every computer you use. It will be **optional** and **off by default**, and it is **end-to-end encrypted**: your data is encrypted on your computer before it is uploaded, with a key the server never receives.

> **Not available yet.** The sync server described here is live, but the extension and helper can't turn sync on: there is no Settings → Sync yet, and nothing is uploaded. This page describes how it will work.

## Turning it on (once it's available)

1. In **Settings → Sync**, enter your email address and a name for this computer.
2. Ensō shows a short code, and we email you a sign-in link.
3. Open the link. The page shows the computer's name and the same code. If they match, click **Approve**.
4. On your first computer, Ensō creates your **account key** and shows your **recovery phrase**: 24 words. Write them down and keep them somewhere safe, offline.
5. On another computer, after approving it, enter the 24 words once. Sync starts.

The account page at [enso.wicker.life/account](/account) lists your devices and storage, and lets you remove a device, export everything, or delete the account.

## Your key and recovery phrase

- When you first turn on sync, Ensō generates a random **256-bit account key** on your computer and keeps it in the system's secret store (the macOS Keychain, Windows Credential Manager or your Linux keyring).
- The **recovery phrase** is that same key written as 24 words (the BIP-39 English word list: 256 bits plus an 8-bit checksum). Anyone with the phrase can decrypt your data; nobody without it can, including us.
- **If you lose every computer and the phrase, your synced data cannot be recovered.** We can't reset it, because we never had it. Your data on any remaining computer is unaffected.

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

Each item has a version. A computer uploads a change only if the item is still at the version it last saw; if another computer changed it in the meantime, the upload is refused and Ensō fetches the newer version, merges, and tries again. Changes are never silently overwritten.

## Limits

- **1 GB** of encrypted storage per account.
- **16 MB** per item.
- A few hundred requests per minute per device.

## Removing a computer, or everything

- **Remove a device** on the account page: its access ends immediately. Its local data stays on that computer.
- **Delete your account** on the account page: every item is deleted from storage at once, every device is signed out, and your email address is removed. Ensō keeps working locally on each computer.
- **Export** first if you want a copy: it downloads every item, still encrypted, as one JSON file.
