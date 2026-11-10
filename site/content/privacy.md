---
title: Privacy policy
description: What Ensō and enso.wicker.life collect, why, where it is kept, and your rights.
---

# Privacy policy

<p class="lede">Ensō is built so that we hold as little about you as possible. This policy covers the Ensō extension and helper, and the website and sync service at enso.wicker.life.</p>

*Last updated 9 November 2026.*

**Who we are.** Ensō is made and run by David Wicker, an individual developer in the Netherlands, who is the controller for the data described here. Contact: [privacy@enso.wicker.life](mailto:privacy@enso.wicker.life).

## The extension and the helper

The Ensō extension and local helper run on your Mac. They store your conversations, memory, profile, settings, skills, reports and activity log as files in your home folder (listed in [Privacy & data](/docs/privacy-data)). **We do not receive any of it.** The extension and helper contain no analytics, telemetry or crash reporting.

When you send a message, the helper sends it to **Anthropic**, together with the context needed to answer it: your profile and memory, the conversation so far, the current page if included, mentioned tabs, attachments, screenshots and tool results. This goes either through Claude Code under your Claude subscription, or to the Anthropic API under your own API key. Anthropic processes it as your provider, under the terms and privacy policy you accepted with them; we are not a party to that and never see it.

When Ensō uses a tool you enabled, the request goes to that service (for example Google, for Gmail) under your account there.

Ensō never reads or acts on banking, payment, tax, health or password-manager sites.

## The website

When you visit enso.wicker.life, the server and its reverse proxy may record standard request data in operational logs: IP address, time, the page requested, the response status and your browser's user agent. We use these logs only to run and secure the service, and keep them no longer than 30 days.

We may count page views with **Umami**, a self-hosted analytics tool that sets no cookies and stores no IP addresses or personal identifiers. Account pages and the API are excluded.

The site sets cookies only when you sign in: a session cookie, which is necessary for the account page to work.

## Updates

Zen and Firefox check `enso.wicker.life/updates.json` for new extension versions and download them from the site. These requests appear in the request logs above, like any other visit. The install script downloads the helper from the site in the same way.

## Sync (optional)

Sync is off unless you turn it on. If you do, we process:

| Data | Why | Kept |
|---|---|---|
| Your email address | To sign you in with emailed links and identify your account | Until you delete the account |
| Device names you choose, when each device was added and last used | So you can see and remove devices | Until you remove the device or delete the account |
| A hash of each device token | To check requests; the token itself is never stored | Until the device is removed |
| Encrypted items: an opaque key, the ciphertext, its size, a version number, the time it changed and which device changed it | To store and sync your data | Until you delete the item or the account; deletion markers for 90 days |
| Sign-in links (stored as hashes) | To complete sign-in | 15 minutes |
| Device sign-in requests: device name, a short code, the requesting IP address | To show you what you are approving | Deleted a day after they expire |
| Web sign-in sessions: IP address and browser user agent | To keep you signed in on the account page, and spot misuse | Until you sign out, or 30 days |
| Request logs (as above) | Security and debugging | Up to 30 days |

Everything you sync is **encrypted on your device** before it is sent, with a key that is created on your device and never leaves it. Item names are replaced by keyed hashes. **We cannot read your synced data**, its titles or its names, and we cannot recover it for you if you lose your key and recovery phrase. We cannot hand readable content to anyone, because we do not have it.

The legal basis for processing this data is the contract with you to provide sync (GDPR Art. 6(1)(b)), and our legitimate interest in keeping the service secure (Art. 6(1)(f)) for logs and rate limits.

## Where data is stored, and who helps us

The website and sync service run on a server we rent from **Hetzner Online** in Falkenstein, Germany. Encrypted items are stored in Hetzner Object Storage in Germany, and the database in Germany; nightly database backups are kept for 30 days in Hetzner's Helsinki, Finland region. Sign-in emails are sent by our own mail server on the same infrastructure. Data does not leave the European Union.

We do not sell, rent or share your data, and we do not use it for advertising or to train any model.

## Your rights

You can, at any time and without asking us:

- **see and download** what we hold: the account page's *Export* gives you your account details, your devices and every encrypted item;
- **remove a device**, which ends its access immediately;
- **delete your account**: this deletes every encrypted item from storage, signs out every device and removes your email address, immediately. Copies in database backups expire within 30 days.

You also have the right to rectification, restriction, objection and portability under the GDPR. Write to [privacy@enso.wicker.life](mailto:privacy@enso.wicker.life) for anything the account page doesn't cover. You can complain to the Dutch Data Protection Authority (Autoriteit Persoonsgegevens) or the authority where you live.

## Children

Ensō is not meant for children under 16, and we don't knowingly hold their data.

## Changes

If this policy changes in a way that affects your data, we will update the date above and, if you have a sync account, email you before the change takes effect.
