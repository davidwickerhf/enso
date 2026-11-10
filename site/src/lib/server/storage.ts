/**
 * Where bytes live: Hetzner Object Storage (S3) in production, or the
 * `objects` table in Postgres when no S3 credentials are configured
 * (development, tests, or a deliberate BLOB_STORAGE=postgres).
 *
 * Two buckets, following wicker-infra docs/storage.md:
 *   private: wicker-01-private/enso/sync/...      encrypted sync blobs
 *   public:  wicker-01-assets/enso/releases/...    signed .xpi files and helper tarballs
 */
import { AwsClient } from 'aws4fetch';
import { config } from './config';
import { query } from './db';

export type Bucket = 'private' | 'public';

export interface ObjectStore {
	readonly driver: 's3' | 'postgres';
	put(bucket: Bucket, key: string, data: Uint8Array, contentType?: string): Promise<void>;
	get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
	delete(bucket: Bucket, key: string): Promise<void>;
	/** A public URL for a public-bucket object, or null if it must be streamed by the app. */
	publicUrl(key: string): string | null;
}

class PostgresStore implements ObjectStore {
	readonly driver = 'postgres' as const;
	async put(bucket: Bucket, key: string, data: Uint8Array) {
		await query(
			`INSERT INTO objects (bucket, key, data) VALUES ($1, $2, $3)
			 ON CONFLICT (bucket, key) DO UPDATE SET data = EXCLUDED.data`,
			[bucket, key, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]
		);
	}
	async get(bucket: Bucket, key: string) {
		const { rows } = await query<{ data: Buffer }>(`SELECT data FROM objects WHERE bucket = $1 AND key = $2`, [bucket, key]);
		return rows[0] ? new Uint8Array(rows[0].data) : null;
	}
	async delete(bucket: Bucket, key: string) {
		await query(`DELETE FROM objects WHERE bucket = $1 AND key = $2`, [bucket, key]);
	}
	publicUrl() {
		return null;
	}
}

class S3Store implements ObjectStore {
	readonly driver = 's3' as const;
	private client = new AwsClient({
		accessKeyId: config.s3.accessKeyId,
		secretAccessKey: config.s3.secretAccessKey,
		region: config.s3.region,
		service: 's3'
	});

	private url(bucket: Bucket, key: string) {
		const name = bucket === 'private' ? config.s3.privateBucket : config.s3.publicBucket;
		const path = key.split('/').map(encodeURIComponent).join('/');
		// Path-style against the regional endpoint (docs/storage.md).
		return `${config.s3.endpoint}/${name}/${path}`;
	}

	async put(bucket: Bucket, key: string, data: Uint8Array, contentType = 'application/octet-stream') {
		const res = await this.client.fetch(this.url(bucket, key), {
			method: 'PUT',
			body: data as BodyInit,
			headers: {
				'content-type': contentType,
				...(bucket === 'public' ? { 'cache-control': 'public, max-age=31536000, immutable' } : {})
			}
		});
		if (!res.ok) throw new Error(`S3 PUT ${bucket}/${key} failed: ${res.status} ${await res.text().catch(() => '')}`);
	}

	async get(bucket: Bucket, key: string) {
		const res = await this.client.fetch(this.url(bucket, key));
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`S3 GET ${bucket}/${key} failed: ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}

	async delete(bucket: Bucket, key: string) {
		const res = await this.client.fetch(this.url(bucket, key), { method: 'DELETE' });
		if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${bucket}/${key} failed: ${res.status}`);
	}

	publicUrl(key: string) {
		return `${config.s3.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
	}
}

let store: ObjectStore | undefined;

export function getStore(): ObjectStore {
	store ??= config.storageDriver === 's3' ? new S3Store() : new PostgresStore();
	return store;
}

/** For tests: forget the cached store after changing env. */
export function resetStore() {
	store = undefined;
}

export const syncObjectKey = (userId: string, blobKey: string, version: number) =>
	`${config.s3.prefix}/sync/${userId}/${blobKey}/${version}`;

export const releaseObjectKey = (filename: string) => `${config.s3.prefix}/releases/${filename}`;
