/**
 * Where "Get it for Firefox" points: the public addons.mozilla.org listing once
 * it exists, otherwise the signed .xpi on this site.
 *
 * FIREFOX_ADDON_URL decides it by configuration:
 *   unset    ask AMO's public API whether the add-on (the first EXTENSION_IDS
 *            entry) is public, cached for an hour (5 minutes after a failure);
 *   a URL    always that listing;
 *   direct   always the direct download.
 */
import { config } from './config';

export const DIRECT_DOWNLOAD = '/releases/enso-latest.xpi';
const AMO_API = 'https://addons.mozilla.org/api/v5/addons/addon/';
const HOUR = 60 * 60 * 1000;
const RETRY = 5 * 60 * 1000;

export type FirefoxLink = { href: string; listed: boolean };

let cache: { link: FirefoxLink; until: number } | null = null;
let inflight: Promise<FirefoxLink> | null = null;

const direct: FirefoxLink = { href: DIRECT_DOWNLOAD, listed: false };

async function askAmo(fetcher: typeof fetch): Promise<{ link: FirefoxLink; ttl: number }> {
	const id = config.extensionIds[0];
	try {
		const res = await fetcher(`${AMO_API}${encodeURIComponent(id)}/?lang=en-US`, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(3000)
		});
		// 401/403/404: not listed (or not public) yet.
		if (!res.ok) return { link: direct, ttl: res.status >= 500 ? RETRY : HOUR };
		const data = (await res.json()) as { status?: string; slug?: string; current_version?: unknown; is_disabled?: boolean };
		if (data.status !== 'public' || !data.current_version || data.is_disabled || !data.slug) return { link: direct, ttl: HOUR };
		return { link: { href: `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(data.slug)}/`, listed: true }, ttl: HOUR };
	} catch {
		return { link: direct, ttl: RETRY };
	}
}

export async function firefoxLink(fetcher: typeof fetch = fetch, now = Date.now()): Promise<FirefoxLink> {
	const setting = (process.env.FIREFOX_ADDON_URL ?? '').trim();
	if (setting === 'direct') return direct;
	if (/^https:\/\//.test(setting)) return { href: setting, listed: true };
	if (cache && cache.until > now) return cache.link;
	inflight ??= askAmo(fetcher)
		.then(({ link, ttl }) => {
			cache = { link, until: now + ttl };
			return link;
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

/** For tests. */
export function resetFirefoxLink() {
	cache = null;
	inflight = null;
}
