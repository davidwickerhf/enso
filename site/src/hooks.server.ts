import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { config } from '$lib/server/config';
import { query } from '$lib/server/db';
import { purgeTombstones } from '$lib/server/sync';

// Daily housekeeping: old tombstones, expired device requests, sessions and sign-in links.
if (!building && process.env.VITEST !== 'true') {
	const housekeeping = async () => {
		try {
			await purgeTombstones();
			await query(`DELETE FROM device_requests WHERE expires_at < now() - interval '1 day'`);
			await query(`DELETE FROM "session" WHERE "expiresAt" < now()`);
			await query(`DELETE FROM "verification" WHERE "expiresAt" < now()`);
		} catch (err) {
			console.warn('housekeeping failed', err instanceof Error ? err.message : err);
		}
	};
	setTimeout(housekeeping, 60_000).unref();
	setInterval(housekeeping, 24 * 60 * 60_000).unref();
}

// Cookieless page-view counts (Umami), never on account pages.
const analytics = (path: string) =>
	config.umamiWebsiteId && !path.startsWith('/account')
		? `<script defer src="https://analytics.wicker.life/wa.js" data-website-id="${config.umamiWebsiteId}" data-domains="enso.wicker.life"></script>`
		: '';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%enso.analytics%', analytics(event.url.pathname))
	});
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
	if (config.production) response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	return response;
};
