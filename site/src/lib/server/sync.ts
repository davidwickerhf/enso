/**
 * Zero-knowledge blob sync. The server stores opaque, client-encrypted blobs
 * under client-chosen keys (keyed hashes, so names reveal nothing) and keeps
 * only what it needs to run the service: key, version, size, timestamps and
 * which device wrote it.
 *
 * Concurrency: every write takes the account row lock, so writes per account
 * are serialized; versions are per blob (1, 2, 3, …) and `seq` is a global
 * sequence taken under that lock, which makes it a safe manifest cursor.
 * Object keys carry a random suffix so a losing concurrent writer can never
 * overwrite the winner's bytes.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { config } from './config';
import { query, tx } from './db';
import { getStore, syncObjectKey } from './storage';

/** Blob keys: keyed-hash output (base64url or hex), or short ASCII names. */
export const BLOB_KEY = /^[A-Za-z0-9._-]{1,128}$/;
export const TOMBSTONE_DAYS = 90;

export type Precondition = { ifMatch?: number | null; ifNoneMatchAny?: boolean };

export type PutResult =
	| { ok: true; version: number; size: number; created: boolean }
	| { ok: false; error: 'precondition_required' }
	| { ok: false; error: 'precondition_failed'; currentVersion: number | null }
	| { ok: false; error: 'quota_exceeded'; usedBytes: number; quotaBytes: number }
	| { ok: false; error: 'too_large'; maxBytes: number };

type BlobRow = { version: number; size: number; object_key: string | null; deleted: boolean; updated_at: Date };

async function ensureAccount(client: pg.PoolClient | null, userId: string) {
	const q = client ? client.query.bind(client) : query;
	await q(`INSERT INTO sync_accounts (user_id, quota_bytes) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [
		userId,
		config.quotaBytes
	]);
}

/** Check If-Match / If-None-Match against the current row. */
function checkPrecondition(row: BlobRow | undefined, pre: Precondition): PutResult | null {
	const live = row && !row.deleted;
	if (pre.ifNoneMatchAny) {
		return live ? { ok: false, error: 'precondition_failed', currentVersion: row.version } : null;
	}
	if (pre.ifMatch == null) return { ok: false, error: 'precondition_required' };
	if (!live || row.version !== pre.ifMatch) {
		return { ok: false, error: 'precondition_failed', currentVersion: live ? row.version : null };
	}
	return null;
}

export async function putBlob(userId: string, deviceId: string | null, key: string, data: Uint8Array, pre: Precondition): Promise<PutResult> {
	if (data.byteLength > config.maxBlobBytes) return { ok: false, error: 'too_large', maxBytes: config.maxBlobBytes };
	await ensureAccount(null, userId);

	// Cheap early check, so a doomed write doesn't upload anything.
	const current = (
		await query<BlobRow>(`SELECT version, size, object_key, deleted, updated_at FROM blobs WHERE user_id = $1 AND key = $2`, [userId, key])
	).rows[0];
	const early = checkPrecondition(current, pre);
	if (early) return early;

	const store = getStore();
	const objectKey = syncObjectKey(userId, key, (current?.version ?? 0) + 1) + '-' + randomUUID().slice(0, 8);
	await store.put('private', objectKey, data);

	let oldObject: string | null = null;
	try {
		const result = await tx(async (client) => {
			const account = (
				await client.query<{ used_bytes: number; quota_bytes: number }>(
					`SELECT used_bytes, quota_bytes FROM sync_accounts WHERE user_id = $1 FOR UPDATE`,
					[userId]
				)
			).rows[0];
			const row = (
				await client.query<BlobRow>(
					`SELECT version, size, object_key, deleted, updated_at FROM blobs WHERE user_id = $1 AND key = $2 FOR UPDATE`,
					[userId, key]
				)
			).rows[0];
			const failed = checkPrecondition(row, pre);
			if (failed) return failed;

			const oldSize = row && !row.deleted ? row.size : 0;
			const used = account.used_bytes - oldSize + data.byteLength;
			if (used > account.quota_bytes) {
				return { ok: false, error: 'quota_exceeded', usedBytes: account.used_bytes, quotaBytes: account.quota_bytes } as const;
			}
			const version = (row?.version ?? 0) + 1;
			await client.query(
				`INSERT INTO blobs (user_id, key, version, size, object_key, deleted, updated_at, updated_by, seq)
				 VALUES ($1, $2, $3, $4, $5, false, now(), $6, nextval('blob_seq'))
				 ON CONFLICT (user_id, key) DO UPDATE SET version = EXCLUDED.version, size = EXCLUDED.size,
				   object_key = EXCLUDED.object_key, deleted = false, updated_at = now(),
				   updated_by = EXCLUDED.updated_by, seq = EXCLUDED.seq`,
				[userId, key, version, data.byteLength, objectKey, deviceId]
			);
			await client.query(`UPDATE sync_accounts SET used_bytes = $2 WHERE user_id = $1`, [userId, used]);
			oldObject = row?.object_key ?? null;
			return { ok: true, version, size: data.byteLength, created: !row || row.deleted } as const;
		});
		if (!result.ok) await store.delete('private', objectKey).catch(() => {});
		else if (oldObject) await store.delete('private', oldObject).catch((e) => console.warn('sync: old object not deleted', e));
		return result;
	} catch (err) {
		await store.delete('private', objectKey).catch(() => {});
		throw err;
	}
}

export async function getBlob(userId: string, key: string) {
	const row = (
		await query<BlobRow>(
			`SELECT version, size, object_key, deleted, updated_at FROM blobs WHERE user_id = $1 AND key = $2 AND NOT deleted`,
			[userId, key]
		)
	).rows[0];
	if (!row || !row.object_key) return null;
	const data = await getStore().get('private', row.object_key);
	if (!data) throw new Error(`sync: object missing for blob ${key}`);
	return { version: row.version, size: row.size, updatedAt: row.updated_at, data };
}

export type DeleteResult =
	| { ok: true; version: number }
	| { ok: false; error: 'not_found' }
	| { ok: false; error: 'precondition_failed'; currentVersion: number };

/** Deletes a blob, leaving a tombstone (kept TOMBSTONE_DAYS) so other devices learn about it. */
export async function deleteBlob(userId: string, key: string, ifMatch: number | null): Promise<DeleteResult> {
	let oldObject: string | null = null;
	const result = await tx(async (client): Promise<DeleteResult> => {
		await client.query(`SELECT 1 FROM sync_accounts WHERE user_id = $1 FOR UPDATE`, [userId]);
		const row = (
			await client.query<BlobRow>(`SELECT version, size, object_key, deleted, updated_at FROM blobs WHERE user_id = $1 AND key = $2 FOR UPDATE`, [
				userId,
				key
			])
		).rows[0];
		if (!row || row.deleted) return { ok: false, error: 'not_found' };
		if (ifMatch != null && ifMatch !== row.version) return { ok: false, error: 'precondition_failed', currentVersion: row.version };
		await client.query(
			`UPDATE blobs SET version = version + 1, size = 0, object_key = NULL, deleted = true, updated_at = now(), seq = nextval('blob_seq')
			 WHERE user_id = $1 AND key = $2`,
			[userId, key]
		);
		await client.query(`UPDATE sync_accounts SET used_bytes = greatest(used_bytes - $2, 0) WHERE user_id = $1`, [userId, row.size]);
		oldObject = row.object_key;
		return { ok: true, version: row.version + 1 };
	});
	if (oldObject) await getStore().delete('private', oldObject).catch((e) => console.warn('sync: object not deleted', e));
	return result;
}

export type ManifestEntry = { key: string; version: number; size: number; deleted: boolean; updatedAt: string; seq: number };

/** Every blob and tombstone changed after `since` (a cursor from an earlier manifest), oldest change first. */
export async function manifest(userId: string, since = 0, limit = 1000) {
	const { rows } = await query<{ key: string; version: number; size: number; deleted: boolean; updated_at: Date; seq: number }>(
		`SELECT key, version, size, deleted, updated_at, seq FROM blobs
		 WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
		[userId, since, limit + 1]
	);
	const more = rows.length > limit;
	const entries: ManifestEntry[] = rows.slice(0, limit).map((r) => ({
		key: r.key,
		version: r.version,
		size: r.size,
		deleted: r.deleted,
		updatedAt: r.updated_at.toISOString(),
		seq: r.seq
	}));
	return { entries, cursor: entries.length ? entries[entries.length - 1].seq : since, more };
}

export async function usage(userId: string) {
	const { rows } = await query<{ used_bytes: number | null; quota_bytes: number | null; blob_count: number }>(
		`SELECT a.used_bytes, a.quota_bytes,
		        (SELECT count(*)::int FROM blobs b WHERE b.user_id = $1 AND NOT b.deleted) AS blob_count
		 FROM (SELECT 1) one LEFT JOIN sync_accounts a ON a.user_id = $1`,
		[userId]
	);
	const r = rows[0];
	return { usedBytes: r?.used_bytes ?? 0, quotaBytes: r?.quota_bytes ?? config.quotaBytes, blobCount: r?.blob_count ?? 0 };
}

/** Removes tombstones older than TOMBSTONE_DAYS. Run daily. */
export async function purgeTombstones() {
	const { rowCount } = await query(
		`DELETE FROM blobs WHERE deleted AND updated_at < now() - make_interval(days => $1)`,
		[TOMBSTONE_DAYS]
	);
	return rowCount ?? 0;
}

/** Iterates every live blob with its bytes, for the account export. */
export async function* exportBlobs(userId: string) {
	const { rows } = await query<{ key: string; version: number; size: number; object_key: string; updated_at: Date }>(
		`SELECT key, version, size, object_key, updated_at FROM blobs WHERE user_id = $1 AND NOT deleted ORDER BY key`,
		[userId]
	);
	const store = getStore();
	for (const r of rows) {
		const data = await store.get('private', r.object_key);
		yield { key: r.key, version: r.version, size: r.size, updatedAt: r.updated_at.toISOString(), data };
	}
}

/**
 * Deletes the account and everything in it: all blob objects first (so a
 * storage outage can't leave orphaned ciphertext behind a deleted account),
 * then the user row, which cascades to sessions, devices, blobs and quota.
 */
export async function deleteAccount(userId: string) {
	const { rows } = await query<{ object_key: string }>(
		`SELECT object_key FROM blobs WHERE user_id = $1 AND object_key IS NOT NULL`,
		[userId]
	);
	const store = getStore();
	for (const r of rows) await store.delete('private', r.object_key);
	await query(`DELETE FROM "user" WHERE id = $1`, [userId]);
	return { deletedBlobs: rows.length };
}
