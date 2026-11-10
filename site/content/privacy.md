---
title: Privacy policy
description: What Ensō and enso.wicker.life collect, why, where it is kept, and your rights.
---

# Privacy policy

<p class="lede">Ensō is built so that we hold as little about you as possible. This policy covers the Ensō extension (including the version listed on addons.mozilla.org) and helper, and the website and sync service at enso.wicker.life.</p>

*Last updated 10 November 2026.*

**Who we are.** Ensō is made and run by David Wicker, an individual developer in the Netherlands, who is the controller for the data described here. Contact: [privacy@enso.wicker.life](mailto:privacy@enso.wicker.life).

## The extension and the helper

The Ensō extension and local helper run on your computer (macOS, Linux or Windows). They store your conversations, memory, profile, settings, skills, reports, activity log and saved screenshots as files in your home folder (listed in [Privacy & data](/docs/privacy-data)). Keys and sign-in tokens are kept in your system's secret store: the macOS Keychain, the Windows Credential Manager, or your Linux keyring; on Linux without a keyring, in a file in Ensō's folder that only your user account can read. With the Claude subscription engine, **Claude Code** also keeps its own transcript of each Ensō conversation in `~/.claude/projects/` on your computer, under its own rules. **We do not receive any of it.** The extension and helper contain no analytics, telemetry or crash reporting.

When you send a message, the helper sends it to **Anthropic**, together with the context needed to answer it: your profile and memory, the conversation so far, the current page if included, mentioned tabs, attachments, screenshots and tool results. This goes either through Claude Code under your Claude subscription, or to the Anthropic API under your own API key. Anthropic processes it as your provider, under the terms and privacy policy you accepted with them; we are not a party to that and never see it.

**The Home brief** also goes to Anthropic, without you sending a message. By default, about once an hour while Ensō is running, the helper asks Claude to write the brief on the new tab: it sends your profile and memory and what your read-only tools return (today's calendar, mail, tasks, a GitHub summary). To stop it, set *Settings → Home → Refresh the briefing* to **Off**; the brief then only updates when you press its refresh button.

**Search suggestions.** As you type in the new tab's search box, the text goes to your default search engine's suggestion service (Google or DuckDuckGo), without cookies, the same way Firefox's own address bar suggests searches.

When Ensō uses a tool you enabled, the request goes to that service (for example Google, for Gmail) under your account there. Tools you connect with the *Connect* button (such as monday.com or Commonfold) sign in with OAuth; their tokens are kept in your system's secret store, and the helper calls those services directly, including every few minutes for the Tasks and monday.com widgets on the new tab.

**Other AI agents.** If you connect agents such as Claude Code, Codex or Cursor to Zen through Ensō (`enso mcp`), whatever they read from your browser (tab lists, page text, screenshots, history results, console and network logs, GitHub data) goes to that agent and its own AI provider (for example Anthropic for Claude Code, OpenAI for Codex), under your terms with them. Nothing passes through us.

**Screenshots you send.** "Send screenshot" stays on your computer: the image goes to your own T3 Code server on this computer, to an agent you connected, or to the clipboard. What that agent then does with it, including sending it to its AI provider, is between you and that agent.

**Private sites.** Ensō never reads, screenshots, or acts on these sites, and never uses your session on them or copies it:

- banks and payment services (any site with "bank" in its address, PayPal, Wise, Revolut, bunq, N26, Monzo, Chase, American Express);
- password managers (1Password, Bitwarden, LastPass, Dashlane);
- health sites (any address containing "health" or "patient");
- tax authorities and government identity portals: the Dutch Belastingdienst, Toeslagen, MijnOverheid and DigiD; the US IRS, Social Security and Login.gov; HMRC, GOV.UK tax services and GOV.UK One Login; ELSTER (Germany), impots.gouv.fr (France), Agenzia delle Entrate (Italy), Agencia Tributaria (Spain), MyMinfin (Belgium), the Australian Taxation Office and myGov, and Inland Revenue (New Zealand).

The exact list is in the [source code](https://github.com/davidwickerhf/enso/blob/main/helper/config.json). The list matches site addresses, so a bank or office whose address isn't on it isn't covered; you can add your own sites in `config.local.json` ([how](/docs/privacy-data#private-sites)).

## The website

When you visit enso.wicker.life, the server and its reverse proxy may record standard request data in operational logs: IP address, time, the page requested, the response status and your browser's user agent. We use these logs only to run and secure the service, and keep them no longer than 30 days.

We may count page views with **Umami**, a self-hosted analytics tool that sets no cookies and stores no IP addresses or personal identifiers. Account pages and the API are excluded.

The site sets cookies only when you sign in: a session cookie, which is necessary for the account page to work.

## Installing and updates

If you install Ensō from **addons.mozilla.org**, Mozilla provides the download and the updates, under [Mozilla's privacy policy](https://www.mozilla.org/privacy/websites/); we receive no information about you from that.

Copies installed directly from our site check `enso.wicker.life/updates.json` for new versions and download them from the site, until they move to the addons.mozilla.org version with their next update. These requests appear in the request logs above, like any other visit. The install script downloads the helper from the site in the same way.

## Sync (not available yet)

**The Ensō extension and helper can't sync yet: there is no way to turn sync on, and nothing of yours is uploaded.** The sync service already runs on the website, and you can sign in to its account page. When sync arrives in Ensō it will be off unless you turn it on. For a sync account we process:

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

- **10 November 2026:** the helper now also runs on Linux and Windows, with secrets in each system's own store; added the Home brief, Claude Code's transcripts, other agents, screenshots, OAuth-connected tools and the addons.mozilla.org listing; tax and government sites are now on the private-site list, which is described in full; sync is marked as not available yet.
