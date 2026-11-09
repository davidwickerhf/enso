/**
 * Runtime configuration, read from process.env so the same modules work in
 * SvelteKit (adapter-node), in the tests and in scripts. Names only are
 * documented in docs/HOSTING.md and .env.example.
 */

const int = (name: string, fallback: number) => {
	const raw = process.env[name];
	if (!raw) return fallback;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
	return n;
};

export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;

export const config = {
	get production() {
		return process.env.NODE_ENV === 'production';
	},
	/** Public origin used in emails, the update feed and release links. */
	get publicUrl() {
		return (process.env.PUBLIC_URL || process.env.BETTER_AUTH_URL || 'http://localhost:5173').replace(/\/$/, '');
	},
	get databaseUrl() {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL is not set');
		return url;
	},
	/** Add-on ids the update feed answers for (comma separated). The first is the current one. */
	get extensionIds() {
		return (process.env.EXTENSION_IDS || 'zen-chat@wicker.life')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	},
	get releaseToken() {
		return process.env.RELEASE_TOKEN || '';
	},
	get emailFrom() {
		return process.env.EMAIL_FROM || 'Ensō <noreply@enso.wicker.life>';
	},
	get smtpUrl() {
		return process.env.SMTP_URL || '';
	},
	/** Default per-account storage quota for sync. */
	get quotaBytes() {
		return int('SYNC_QUOTA_BYTES', GiB);
	},
	/** Largest single encrypted blob accepted by PUT /api/sync/blobs/:key. */
	get maxBlobBytes() {
		return int('SYNC_MAX_BLOB_BYTES', 16 * MiB);
	},
	/** Largest release artifact accepted by the publish endpoint. */
	get maxReleaseBytes() {
		return int('RELEASE_MAX_BYTES', 200 * MiB);
	},
	/** Sync requests allowed per device token per minute. */
	get syncRateLimit() {
		return int('SYNC_RATE_LIMIT_PER_MINUTE', 300);
	},
	/** Blob storage: "s3" when the S3 variables are set, otherwise Postgres. */
	get storageDriver(): 's3' | 'postgres' {
		const explicit = process.env.BLOB_STORAGE;
		if (explicit === 's3' || explicit === 'postgres') return explicit;
		return process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID ? 's3' : 'postgres';
	},
	s3: {
		get endpoint() {
			return (process.env.S3_ENDPOINT || '').replace(/\/$/, '');
		},
		get region() {
			return process.env.S3_REGION || 'fsn1';
		},
		get accessKeyId() {
			return process.env.S3_ACCESS_KEY_ID || '';
		},
		get secretAccessKey() {
			return process.env.S3_SECRET_ACCESS_KEY || '';
		},
		/** Private bucket for encrypted sync blobs. */
		get privateBucket() {
			return process.env.S3_PRIVATE_BUCKET || 'wicker-01-private';
		},
		/** Public-read bucket for release artifacts. */
		get publicBucket() {
			return process.env.S3_PUBLIC_BUCKET || 'wicker-01-assets';
		},
		get publicBaseUrl() {
			return (process.env.S3_PUBLIC_BASE_URL || 'https://wicker-01-assets.fsn1.your-objectstorage.com').replace(/\/$/, '');
		},
		/** Key prefix inside both buckets. */
		get prefix() {
			return (process.env.S3_PREFIX || 'enso').replace(/\/$/, '');
		}
	},
	get umamiWebsiteId() {
		return process.env.PUBLIC_UMAMI_WEBSITE_ID || '';
	}
};
