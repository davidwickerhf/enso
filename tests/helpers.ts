import { afterAll, beforeEach } from 'vitest';
import { testDatabaseUrl } from './globalSetup';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.BETTER_AUTH_SECRET ||= 'test-secret-test-secret-test-secret-0123';
process.env.PUBLIC_URL = 'http://localhost:5173';
process.env.MAIL_SILENT = 'true';
process.env.AUTH_RATE_LIMIT = 'off';
process.env.RELEASE_TOKEN = 'test-release-token';
delete process.env.SMTP_URL;
delete process.env.S3_ENDPOINT;
delete process.env.BLOB_STORAGE;

const { getAuth } = await import('$lib/server/auth');
const { closePool, query } = await import('$lib/server/db');
const { outbox } = await import('$lib/server/mail');
const { resetLimits } = await import('$lib/server/ratelimit');
const { resetStore } = await import('$lib/server/storage');
const { createDeviceToken } = await import('$lib/server/devices');

export { query };

beforeEach(async () => {
	await query(`TRUNCATE "user", "session", "account", "verification", devices, device_requests, sync_accounts, blobs, objects, releases CASCADE`);
	outbox.length = 0;
	resetLimits();
	resetStore();
	delete process.env.SYNC_QUOTA_BYTES;
	delete process.env.SYNC_MAX_BLOB_BYTES;
	delete process.env.SYNC_RATE_LIMIT_PER_MINUTE;
});

afterAll(async () => {
	await closePool();
});

export const BASE = 'http://localhost:5173';

/** The link in the newest logged mail. */
export function lastLink() {
	const mail = outbox.at(-1);
	if (!mail) throw new Error('no mail was sent');
	const m = mail.text.match(/https?:\/\/\S+/);
	if (!m) throw new Error('no link in mail');
	return { url: m[0], mail };
}

/** Signs up/in by magic link, the way the account page does. Returns the session cookie. */
export async function signIn(email: string) {
	await getAuth().api.signInMagicLink({ body: { email, callbackURL: '/account' }, headers: new Headers() });
	const { url } = lastLink();
	const res = await getAuth().handler(new Request(url));
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	const { rows } = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
	return { res, cookie, userId: rows[0]?.id as string };
}

export async function deviceFor(email: string, name = 'Test Mac') {
	const { userId } = await signIn(email);
	const { token, device } = await createDeviceToken(userId, name);
	return { userId, token, deviceId: device.id };
}

export function req(method: string, path: string, opts: { token?: string; body?: BodyInit | object; headers?: Record<string, string> } = {}) {
	const headers = new Headers(opts.headers);
	if (opts.token) headers.set('authorization', `Bearer ${opts.token}`);
	let body: BodyInit | undefined;
	if (opts.body instanceof Uint8Array || typeof opts.body === 'string') body = opts.body as BodyInit;
	else if (opts.body) {
		body = JSON.stringify(opts.body);
		headers.set('content-type', 'application/json');
	}
	return new Request(BASE + path, { method, headers, body });
}

export const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
