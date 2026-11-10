import { describe, expect, it } from 'vitest';
import { deviceFor, lastLink, query, req, signIn } from './helpers';
import { devicePoll, devicesList, deviceRevoke, deviceStart, syncUsage } from '$lib/server/api';
import { getSessionUser } from '$lib/server/auth';
import { decideDeviceRequest, getDeviceRequest, sha256 } from '$lib/server/devices';
import { getAuth } from '$lib/server/auth';

describe('magic link sign-up', () => {
	it('creates the account on first use and starts a session', async () => {
		const { res, cookie, userId } = await signIn('ada@example.com');
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toContain('/account');
		expect(userId).toBeTruthy();
		const user = await getSessionUser(new Headers({ cookie }));
		expect(user?.email).toBe('ada@example.com');
	});

	it('sends the link to the address and stores only a hash of the token', async () => {
		await getAuth().api.signInMagicLink({ body: { email: 'bob@example.com', callbackURL: '/account' }, headers: new Headers() });
		const { url, mail } = lastLink();
		expect(mail.to).toBe('bob@example.com');
		const token = new URL(url).searchParams.get('token')!;
		const { rows } = await query<{ identifier: string }>(`SELECT identifier FROM verification`);
		expect(rows.length).toBe(1);
		expect(rows[0].identifier).not.toContain(token);
	});

	it('works only once', async () => {
		await getAuth().api.signInMagicLink({ body: { email: 'cy@example.com', callbackURL: '/account' }, headers: new Headers() });
		const { url } = lastLink();
		const first = await getAuth().handler(new Request(url));
		expect(first.headers.getSetCookie().join()).toContain('session_token');
		const second = await getAuth().handler(new Request(url));
		expect(second.headers.getSetCookie().join()).not.toContain('session_token=');
		expect(second.headers.get('location') ?? '').toMatch(/error/i);
	});

	it('rejects a bad cookie without throwing', async () => {
		expect(await getSessionUser(new Headers({ cookie: 'better-auth.session_token=nope' }))).toBeNull();
	});
});

describe('device tokens', () => {
	it('rejects missing, malformed and unknown tokens', async () => {
		expect((await syncUsage(req('GET', '/api/sync/usage'))).status).toBe(401);
		expect((await syncUsage(req('GET', '/api/sync/usage', { token: 'abc' }))).status).toBe(401);
		expect((await syncUsage(req('GET', '/api/sync/usage', { token: 'enso_' + 'A'.repeat(43) }))).status).toBe(401);
	});

	it('stores only the SHA-256 of a token', async () => {
		const { token } = await deviceFor('dee@example.com');
		const { rows } = await query<{ token_hash: string }>(`SELECT token_hash FROM devices`);
		expect(rows[0].token_hash).toBe(sha256(token));
		expect(JSON.stringify(rows)).not.toContain(token);
	});

	it('lists devices and revokes one immediately', async () => {
		const { token, deviceId, userId } = await deviceFor('eve@example.com', 'Laptop');
		const { createDeviceToken } = await import('$lib/server/devices');
		const other = await createDeviceToken(userId, 'Desktop');
		const list = await (await devicesList(req('GET', '/api/devices', { token }))).json();
		expect(list.devices.map((d: { name: string }) => d.name)).toEqual(['Laptop', 'Desktop']);
		expect(list.devices.find((d: { current: boolean }) => d.current).id).toBe(deviceId);

		const res = await deviceRevoke(req('DELETE', `/api/devices/${other.device.id}`, { token }), other.device.id);
		expect(res.status).toBe(200);
		expect((await syncUsage(req('GET', '/api/sync/usage', { token: other.token }))).status).toBe(401);
		expect((await syncUsage(req('GET', '/api/sync/usage', { token }))).status).toBe(200);
	});

	it("cannot revoke another account's device", async () => {
		const a = await deviceFor('fay@example.com');
		const b = await deviceFor('gus@example.com');
		const res = await deviceRevoke(req('DELETE', `/api/devices/${b.deviceId}`, { token: a.token }), b.deviceId);
		expect(res.status).toBe(404);
		expect((await syncUsage(req('GET', '/api/sync/usage', { token: b.token }))).status).toBe(200);
	});
});

describe('device sign-in flow', () => {
	it('start -> email with code -> approve on the web -> poll returns a token once', async () => {
		const start = await deviceStart(req('POST', '/api/device/start', { body: { email: 'Hal@Example.com', deviceName: 'MacBook Air' } }));
		expect(start.status).toBe(200);
		const { deviceCode, userCode } = await start.json();
		expect(userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

		const { url, mail } = lastLink();
		expect(mail.to).toBe('hal@example.com');
		expect(mail.text).toContain(userCode);
		expect(mail.text).toContain('MacBook Air');

		expect((await devicePoll(req('POST', '/api/device/poll', { body: { deviceCode } }))).status).toBe(202);

		// Following the link signs the user in and lands on the approval page.
		const verify = await getAuth().handler(new Request(url));
		const location = verify.headers.get('location')!;
		const requestId = new URL(location, 'http://x').searchParams.get('request')!;
		expect(location).toContain('/account/approve');
		const pending = await getDeviceRequest(requestId);
		expect(pending?.deviceName).toBe('MacBook Air');

		// Someone signed in with a different address cannot approve it.
		const intruder = await signIn('mallory@example.com');
		expect(await decideDeviceRequest(requestId, { id: intruder.userId, email: 'mallory@example.com' }, 'approved')).toBe(false);

		const { rows } = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'hal@example.com'`);
		expect(await decideDeviceRequest(requestId, { id: rows[0].id, email: 'hal@example.com' }, 'approved')).toBe(true);

		const done = await devicePoll(req('POST', '/api/device/poll', { body: { deviceCode } }));
		expect(done.status).toBe(200);
		const body = await done.json();
		expect(body.token).toMatch(/^enso_[A-Za-z0-9_-]{43}$/);
		expect(body.device.name).toBe('MacBook Air');
		expect((await syncUsage(req('GET', '/api/sync/usage', { token: body.token }))).status).toBe(200);

		const again = await devicePoll(req('POST', '/api/device/poll', { body: { deviceCode } }));
		expect(again.status).toBe(410);
	});

	it('mints exactly one token under concurrent polls', async () => {
		const start = await deviceStart(req('POST', '/api/device/start', { body: { email: 'ivy@example.com', deviceName: 'Mac' } }));
		const { deviceCode } = await start.json();
		const { url } = lastLink();
		const verify = await getAuth().handler(new Request(url));
		const requestId = new URL(verify.headers.get('location')!, 'http://x').searchParams.get('request')!;
		const { rows } = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'ivy@example.com'`);
		await decideDeviceRequest(requestId, { id: rows[0].id, email: 'ivy@example.com' }, 'approved');
		const results = await Promise.all(
			Array.from({ length: 5 }, () => devicePoll(req('POST', '/api/device/poll', { body: { deviceCode } })))
		);
		expect(results.filter((r) => r.status === 200)).toHaveLength(1);
		const { rows: devices } = await query(`SELECT 1 FROM devices`);
		expect(devices).toHaveLength(1);
	});

	it('reports a denied request', async () => {
		const start = await deviceStart(req('POST', '/api/device/start', { body: { email: 'jo@example.com', deviceName: 'Mac' } }));
		const { deviceCode } = await start.json();
		const { url } = lastLink();
		const verify = await getAuth().handler(new Request(url));
		const requestId = new URL(verify.headers.get('location')!, 'http://x').searchParams.get('request')!;
		const { rows } = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = 'jo@example.com'`);
		await decideDeviceRequest(requestId, { id: rows[0].id, email: 'jo@example.com' }, 'denied');
		const res = await devicePoll(req('POST', '/api/device/poll', { body: { deviceCode } }));
		expect(res.status).toBe(410);
		expect((await res.json()).status).toBe('denied');
	});

	it('validates input and rate-limits per email', async () => {
		expect((await deviceStart(req('POST', '/api/device/start', { body: { email: 'not-an-email' } }))).status).toBe(400);
		const statuses = [];
		for (let i = 0; i < 6; i++) {
			const r = await deviceStart(req('POST', '/api/device/start', { body: { email: 'kim@example.com', deviceName: 'Mac' } }));
			statuses.push(r.status);
		}
		expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
		expect(statuses[5]).toBe(429);
	});
});
