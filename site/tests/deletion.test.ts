import { describe, expect, it } from 'vitest';
import { bytes, deviceFor, query, req } from './helpers';
import { accountDelete, syncPut, syncUsage } from '$lib/server/api';

const put = (token: string, key: string, n: number) =>
	syncPut(req('PUT', `/api/sync/blobs/${key}`, { token, body: bytes(n), headers: { 'if-none-match': '*' } }), key);

describe('account deletion', () => {
	it('needs explicit confirmation', async () => {
		const { token } = await deviceFor('del1@example.com');
		expect((await accountDelete(req('DELETE', '/api/account', { token, body: {} }))).status).toBe(400);
		expect((await syncUsage(req('GET', '/api/sync/usage', { token }))).status).toBe(200);
	});

	it('removes every blob, object, device and session, and leaves other accounts alone', async () => {
		const a = await deviceFor('del2@example.com');
		const b = await deviceFor('keep@example.com');
		await put(a.token, 'one', 10);
		await put(a.token, 'two', 20);
		await put(b.token, 'mine', 5);
		expect((await query(`SELECT 1 FROM objects`)).rows).toHaveLength(3);

		const res = await accountDelete(req('DELETE', '/api/account', { token: a.token, body: { confirm: 'delete' } }));
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ deleted: true, deletedBlobs: 2 });

		expect((await syncUsage(req('GET', '/api/sync/usage', { token: a.token }))).status).toBe(401);
		for (const table of ['devices', 'blobs', 'sync_accounts', '"session"']) {
			const col = table === '"session"' ? '"userId"' : 'user_id';
			expect((await query(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [a.userId])).rows).toHaveLength(0);
		}
		expect((await query(`SELECT 1 FROM "user" WHERE id = $1`, [a.userId])).rows).toHaveLength(0);
		expect((await query(`SELECT 1 FROM objects`)).rows).toHaveLength(1);
		expect((await syncUsage(req('GET', '/api/sync/usage', { token: b.token }))).status).toBe(200);
	});
});
