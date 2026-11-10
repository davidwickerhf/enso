/**
 * Better Auth, in-process, like every other app on wicker-01 (see
 * wicker-infra docs/auth.md). Sign-in is by email magic link only, with open
 * sign-up: the first verified link creates the account. Tables: user,
 * session, account, verification (migrations/001_init.sql).
 *
 * Mounted at /api/auth/* by src/routes/api/auth/[...path]/+server.ts.
 */
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { config } from './config';
import { getPool } from './db';
import { magicLinkMail, sendMail } from './mail';
import { deviceRequestForMail } from './devices';

const DAY = 60 * 60 * 24;

function createAuth() {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error('BETTER_AUTH_SECRET is missing or shorter than 32 chars. Generate one with `openssl rand -base64 32`.');
	}
	const baseURL = config.publicUrl;
	const trustedOrigins = [new URL(baseURL).origin, 'https://enso.wicker.life', 'https://enso.c.wicker.life'];
	if (!config.production) trustedOrigins.push('http://localhost:*', 'http://127.0.0.1:*');

	return betterAuth({
		appName: 'Ensō',
		secret,
		baseURL,
		basePath: '/api/auth',
		trustedOrigins: [...new Set(trustedOrigins)],
		database: getPool(),
		session: {
			expiresIn: 30 * DAY,
			updateAge: DAY
		},
		rateLimit: {
			enabled: process.env.AUTH_RATE_LIMIT !== 'off',
			storage: 'memory',
			window: 60,
			max: 60
		},
		advanced: {
			database: { generateId: () => crypto.randomUUID() },
			// Traefik sets X-Real-Ip / X-Forwarded-For.
			ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] }
		},
		telemetry: { enabled: false },
		plugins: [
			magicLink({
				expiresIn: 15 * 60,
				storeToken: 'hashed',
				rateLimit: { window: 15 * 60, max: 5 },
				async sendMagicLink({ email, url }) {
					// Device details come from our own table (via the callback URL),
					// never from client-supplied metadata.
					const device = await deviceRequestForMail(url);
					await sendMail(magicLinkMail(email, url, device ?? undefined));
				}
			})
		]
	});
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Created lazily so importing this module at build time needs no secrets. */
export function getAuth(): Auth {
	instance ??= createAuth();
	return instance;
}

export type SessionUser = { id: string; email: string; name?: string | null; createdAt?: Date };

/** The signed-in web user, or null. Never throws for a bad cookie. */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
	try {
		const s = await getAuth().api.getSession({ headers });
		return s?.user ? { id: s.user.id, email: s.user.email, name: s.user.name, createdAt: s.user.createdAt } : null;
	} catch (err) {
		console.error('auth: getSession failed', err instanceof Error ? err.message : err);
		return null;
	}
}
