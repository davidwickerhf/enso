import { afterEach, describe, expect, it } from 'vitest';
import { DIRECT_DOWNLOAD, firefoxLink, resetFirefoxLink } from '$lib/server/firefox';

const respond = (status: number, body: unknown = {}) => {
	const calls: string[] = [];
	const fetcher = (async (url: string) => {
		calls.push(String(url));
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof fetch;
	return { fetcher, calls };
};

describe('Get it for Firefox', () => {
	afterEach(() => {
		resetFirefoxLink();
		delete process.env.FIREFOX_ADDON_URL;
	});

	it('points at the direct download while the add-on is not public on AMO', async () => {
		const { fetcher, calls } = respond(401, { detail: 'Authentication credentials were not provided.' });
		expect(await firefoxLink(fetcher)).toEqual({ href: DIRECT_DOWNLOAD, listed: false });
		expect(calls[0]).toContain('/api/v5/addons/addon/enso%40wicker.life/');
	});

	it('points at the listing, by its slug, once it is public', async () => {
		const { fetcher } = respond(200, { status: 'public', slug: 'enso', current_version: { version: '0.5.5' } });
		expect(await firefoxLink(fetcher)).toEqual({ href: 'https://addons.mozilla.org/firefox/addon/enso/', listed: true });
	});

	it('treats a listing awaiting review as not public', async () => {
		const { fetcher } = respond(200, { status: 'nominated', slug: 'enso', current_version: null });
		expect((await firefoxLink(fetcher)).listed).toBe(false);
	});

	it('caches the answer for an hour, and retries sooner after a failure', async () => {
		const ok = respond(200, { status: 'public', slug: 'enso', current_version: {} });
		const t = 1_000_000;
		await firefoxLink(ok.fetcher, t);
		await firefoxLink(ok.fetcher, t + 30 * 60_000);
		expect(ok.calls.length).toBe(1);
		await firefoxLink(ok.fetcher, t + 61 * 60_000);
		expect(ok.calls.length).toBe(2);

		resetFirefoxLink();
		const failing = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect((await firefoxLink(failing, t)).listed).toBe(false);
		const later = respond(200, { status: 'public', slug: 'enso', current_version: {} });
		expect((await firefoxLink(later.fetcher, t + 6 * 60_000)).listed).toBe(true);
	});

	it('follows FIREFOX_ADDON_URL without asking AMO', async () => {
		const { fetcher, calls } = respond(500);
		process.env.FIREFOX_ADDON_URL = 'direct';
		expect(await firefoxLink(fetcher)).toEqual({ href: DIRECT_DOWNLOAD, listed: false });
		process.env.FIREFOX_ADDON_URL = 'https://addons.mozilla.org/firefox/addon/enso-browser/';
		expect(await firefoxLink(fetcher)).toEqual({ href: 'https://addons.mozilla.org/firefox/addon/enso-browser/', listed: true });
		expect(calls.length).toBe(0);
	});
});
