/**
 * The S3 driver against a tiny in-process stand-in for Hetzner Object
 * Storage: checks request signing is present, path-style URLs, and that
 * sync and account deletion clean up objects there too.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bytes, deviceFor, query, req } from './helpers';
import { accountDelete, syncGet, syncPut } from '$lib/server/api';
import { resetStore } from '$lib/server/storage';

const objects = new Map<string, Buffer>();
const seen: { method: string; path: string; auth: string }[] = [];
let server: Server;

beforeAll(async () => {
	server = createServer((r, w) => {
		const chunks: Buffer[] = [];
		r.on('data', (c) => chunks.push(c));
		r.on('end', () => {
			const path = decodeURIComponent(r.url!.split('?')[0]);
			seen.push({ method: r.method!, path, auth: String(r.headers.authorization ?? '') });
			if (!String(r.headers.authorization).startsWith('AWS4-HMAC-SHA256')) return w.writeHead(403).end();
			if (r.method === 'PUT') objects.set(path, Buffer.concat(chunks));
			if (r.method === 'DELETE') objects.delete(path);
			if (r.method === 'GET') {
				const o = objects.get(path);
				return o ? w.writeHead(200).end(o) : w.writeHead(404).end();
			}
			w.writeHead(r.method === 'DELETE' ? 204 : 200).end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	Object.assign(process.env, {
		S3_ENDPOINT: `http://127.0.0.1:${port}`,
		S3_ACCESS_KEY_ID: 'test',
		S3_SECRET_ACCESS_KEY: 'test',
		S3_PRIVATE_BUCKET: 'priv',
		S3_PUBLIC_BUCKET: 'pub'
	});
});

beforeEach(() => {
	objects.clear();
	seen.length = 0;
	process.env.BLOB_STORAGE = 's3';
	resetStore();
});

afterAll(async () => {
	delete process.env.BLOB_STORAGE;
	delete process.env.S3_ENDPOINT;
	resetStore();
	await new Promise((resolve) => server.close(resolve));
});

describe('S3 storage driver', () => {
	it('stores sync blobs in the private bucket under enso/sync/<user>/ and replaces old versions', async () => {
		const { token, userId } = await deviceFor('s3@example.com');
		const put = (data: Uint8Array, h: Record<string, string>) =>
			syncPut(req('PUT', '/api/sync/blobs/key1', { token, body: data, headers: h }), 'key1');
		expect((await put(bytes(8, 1), { 'if-none-match': '*' })).status).toBe(201);
		expect((await put(bytes(8, 2), { 'if-match': '"1"' })).status).toBe(200);

		const keys = [...objects.keys()];
		expect(keys).toHaveLength(1);
		expect(keys[0]).toMatch(new RegExp(`^/priv/enso/sync/${userId}/key1/2-[0-9a-f]{8}$`));
		expect(seen.every((s) => s.auth.includes('Credential=test/'))).toBe(true);

		const got = await syncGet(req('GET', '/api/sync/blobs/key1', { token }), 'key1');
		expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes(8, 2));
		expect((await query(`SELECT 1 FROM objects`)).rows).toHaveLength(0);
	});

	it('deletes every object when the account is deleted', async () => {
		const { token } = await deviceFor('s3del@example.com');
		for (const k of ['a', 'b', 'c']) {
			await syncPut(req('PUT', `/api/sync/blobs/${k}`, { token, body: bytes(4), headers: { 'if-none-match': '*' } }), k);
		}
		expect(objects.size).toBe(3);
		const res = await accountDelete(req('DELETE', '/api/account', { token, body: { confirm: 'delete' } }));
		expect(res.status).toBe(200);
		expect(objects.size).toBe(0);
	});
});
