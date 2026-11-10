import { describe, expect, it } from 'vitest';
import { bytes, deviceFor, query, req } from './helpers';
import { syncDelete, syncGet, syncManifest, syncPut, syncUsage } from '$lib/server/api';

const KEY = 'p9Xk2mQ7a1b2c3d4e5f6g7h8i9j0kLmNoPqRsTuVwXy';

const put = (token: string, key: string, data: Uint8Array, headers: Record<string, string> = {}) =>
	syncPut(req('PUT', `/api/sync/blobs/${key}`, { token, body: data, headers: { 'content-type': 'application/octet-stream', ...headers } }), key);
const get = (token: string, key: string, headers: Record<string, string> = {}) => syncGet(req('GET', `/api/sync/blobs/${key}`, { token, headers }), key);

describe('blob versioning', () => {
	it('requires a precondition, creates, reads, updates and detects conflicts', async () => {
		const { token } = await deviceFor('a@example.com');

		expect((await put(token, KEY, bytes(10))).status).toBe(428);

		const created = await put(token, KEY, bytes(10, 1), { 'if-none-match': '*' });
		expect(created.status).toBe(201);
		expect(created.headers.get('etag')).toBe('"1"');
		expect(await created.json()).toEqual({ key: KEY, version: 1, size: 10 });

		// Creating again must not overwrite.
		const dup = await put(token, KEY, bytes(10, 2), { 'if-none-match': '*' });
		expect(dup.status).toBe(412);
		expect((await dup.json()).currentVersion).toBe(1);

		const read = await get(token, KEY);
		expect(read.status).toBe(200);
		expect(read.headers.get('etag')).toBe('"1"');
		expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes(10, 1));
		expect((await get(token, KEY, { 'if-none-match': '"1"' })).status).toBe(304);

		const updated = await put(token, KEY, bytes(12, 3), { 'if-match': '"1"' });
		expect(updated.status).toBe(200);
		expect((await updated.json()).version).toBe(2);

		// A second device still on version 1 loses, and learns the current version.
		const stale = await put(token, KEY, bytes(12, 4), { 'if-match': '"1"' });
		expect(stale.status).toBe(412);
		expect(stale.headers.get('etag')).toBe('"2"');
		expect((await stale.json()).error).toBe('version_conflict');
		expect(new Uint8Array(await (await get(token, KEY)).arrayBuffer())).toEqual(bytes(12, 3));
	});

	it('lets exactly one of two concurrent writers win, and keeps its bytes', async () => {
		const { token } = await deviceFor('b@example.com');
		await put(token, KEY, bytes(5, 0), { 'if-none-match': '*' });
		const [r1, r2] = await Promise.all([put(token, KEY, bytes(5, 1), { 'if-match': '"1"' }), put(token, KEY, bytes(5, 2), { 'if-match': '"1"' })]);
		const statuses = [r1.status, r2.status].sort();
		expect(statuses).toEqual([200, 412]);
		const winner = r1.status === 200 ? 1 : 2;
		expect(new Uint8Array(await (await get(token, KEY)).arrayBuffer())).toEqual(bytes(5, winner));
		// The loser's upload was cleaned up: one object for one blob.
		const { rows } = await query(`SELECT key FROM objects`);
		expect(rows).toHaveLength(1);
	});

	it('deletes with a tombstone that the manifest reports, and allows re-creating', async () => {
		const { token } = await deviceFor('c@example.com');
		await put(token, 'aaa', bytes(3), { 'if-none-match': '*' });
		await put(token, 'bbb', bytes(4), { 'if-none-match': '*' });

		const m1 = await (await syncManifest(req('GET', '/api/sync/manifest', { token }))).json();
		expect(m1.entries.map((e: { key: string }) => e.key)).toEqual(['aaa', 'bbb']);
		expect(m1.usage.usedBytes).toBe(7);

		expect((await syncDelete(req('DELETE', '/api/sync/blobs/aaa', { token, headers: { 'if-match': '"9"' } }), 'aaa')).status).toBe(412);
		const del = await syncDelete(req('DELETE', '/api/sync/blobs/aaa', { token, headers: { 'if-match': '"1"' } }), 'aaa');
		expect(del.status).toBe(200);
		expect((await del.json()).version).toBe(2);
		expect((await get(token, 'aaa')).status).toBe(404);
		expect((await syncDelete(req('DELETE', '/api/sync/blobs/aaa', { token }), 'aaa')).status).toBe(404);

		const m2 = await (await syncManifest(req('GET', `/api/sync/manifest?since=${m1.cursor}`, { token }))).json();
		expect(m2.entries).toHaveLength(1);
		expect(m2.entries[0]).toMatchObject({ key: 'aaa', deleted: true, version: 2, size: 0 });
		expect(m2.usage.usedBytes).toBe(4);

		const again = await put(token, 'aaa', bytes(2), { 'if-none-match': '*' });
		expect(again.status).toBe(201);
		expect((await again.json()).version).toBe(3);
	});

	it('pages the manifest with a cursor', async () => {
		const { token } = await deviceFor('d@example.com');
		for (const k of ['k1', 'k2', 'k3']) await put(token, k, bytes(1), { 'if-none-match': '*' });
		const p1 = await (await syncManifest(req('GET', '/api/sync/manifest?limit=2', { token }))).json();
		expect(p1.entries).toHaveLength(2);
		expect(p1.more).toBe(true);
		const p2 = await (await syncManifest(req('GET', `/api/sync/manifest?limit=2&since=${p1.cursor}`, { token }))).json();
		expect(p2.entries.map((e: { key: string }) => e.key)).toEqual(['k3']);
		expect(p2.more).toBe(false);
	});

	it('keeps accounts apart', async () => {
		const a = await deviceFor('e@example.com');
		const b = await deviceFor('f@example.com');
		await put(a.token, KEY, bytes(3), { 'if-none-match': '*' });
		expect((await get(b.token, KEY)).status).toBe(404);
		expect((await put(b.token, KEY, bytes(3), { 'if-none-match': '*' })).status).toBe(201);
		const mb = await (await syncManifest(req('GET', '/api/sync/manifest', { token: b.token }))).json();
		expect(mb.entries).toHaveLength(1);
	});

	it('rejects invalid keys and preconditions', async () => {
		const { token } = await deviceFor('g@example.com');
		expect((await put(token, 'has/slash', bytes(1), { 'if-none-match': '*' })).status).toBe(400);
		expect((await put(token, 'a'.repeat(129), bytes(1), { 'if-none-match': '*' })).status).toBe(400);
		expect((await put(token, 'ok', bytes(1), { 'if-match': 'banana' })).status).toBe(400);
	});
});

describe('quotas and limits', () => {
	it('enforces the per-account quota, counting replacements and deletions', async () => {
		const { token, userId } = await deviceFor('q@example.com');
		await put(token, 'first', bytes(1), { 'if-none-match': '*' });
		await query(`UPDATE sync_accounts SET quota_bytes = 1000 WHERE user_id = $1`, [userId]);

		expect((await put(token, 'first', bytes(600), { 'if-match': '"1"' })).status).toBe(200);
		const over = await put(token, 'second', bytes(500), { 'if-none-match': '*' });
		expect(over.status).toBe(507);
		expect(await over.json()).toMatchObject({ error: 'quota_exceeded', usedBytes: 600, quotaBytes: 1000 });

		// Replacing a blob only counts the difference.
		expect((await put(token, 'first', bytes(900), { 'if-match': '"2"' })).status).toBe(200);
		expect((await (await syncUsage(req('GET', '/api/sync/usage', { token }))).json()).usedBytes).toBe(900);

		// Deleting frees space.
		await syncDelete(req('DELETE', '/api/sync/blobs/first', { token }), 'first');
		expect((await put(token, 'second', bytes(500), { 'if-none-match': '*' })).status).toBe(201);
		expect(await (await syncUsage(req('GET', '/api/sync/usage', { token }))).json()).toEqual({ usedBytes: 500, quotaBytes: 1000, blobCount: 1 });
		// Nothing from the refused write was left behind.
		const { rows } = await query(`SELECT key FROM objects`);
		expect(rows).toHaveLength(1);
	});

	it('gives new accounts the default 1 GiB quota', async () => {
		const { token } = await deviceFor('r@example.com');
		await put(token, 'x', bytes(1), { 'if-none-match': '*' });
		expect((await (await syncUsage(req('GET', '/api/sync/usage', { token }))).json()).quotaBytes).toBe(1024 ** 3);
	});

	it('refuses blobs over the size limit', async () => {
		process.env.SYNC_MAX_BLOB_BYTES = '1024';
		const { token } = await deviceFor('s@example.com');
		const res = await put(token, 'big', bytes(2000), { 'if-none-match': '*' });
		expect(res.status).toBe(413);
		expect((await put(token, 'small', bytes(1000), { 'if-none-match': '*' })).status).toBe(201);
	});

	it('rate-limits each device', async () => {
		process.env.SYNC_RATE_LIMIT_PER_MINUTE = '5';
		const { token } = await deviceFor('t@example.com');
		const statuses = [];
		for (let i = 0; i < 6; i++) statuses.push((await syncUsage(req('GET', '/api/sync/usage', { token }))).status);
		expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
	});
});
