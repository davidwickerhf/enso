/**
 * Release artifacts: signed extension builds (.xpi) and helper tarballs,
 * published by CI through PUT /api/releases/:kind/:version (bearer
 * RELEASE_TOKEN) and served from /releases/<filename>. The Firefox update
 * feed (/updates.json) and /api/latest read the `releases` table.
 */
import { createHash } from 'node:crypto';
import { config } from './config';
import { query } from './db';
import { getStore, releaseObjectKey } from './storage';

export type ReleaseKind = 'extension' | 'helper';
export const KINDS: ReleaseKind[] = ['extension', 'helper'];
/** Semver-ish versions as Firefox accepts them: 1.2.3, 1.2.3-beta.1, 1.2.3b1. */
export const VERSION = /^\d+(\.\d+){0,3}([a-z][a-z0-9.-]{0,20}|-[0-9A-Za-z.-]{1,20})?$/;

export type Release = {
	kind: ReleaseKind;
	version: string;
	filename: string;
	sha256: string;
	size: number;
	strictMinVersion: string | null;
	notes: string | null;
	createdAt: Date;
};

export const filenameFor = (kind: ReleaseKind, version: string) =>
	kind === 'extension' ? `enso-${version}.xpi` : `enso-helper-${version}-darwin.tar.gz`;

export const releaseUrl = (filename: string) => `${config.publicUrl}/releases/${filename}`;

/** Compares dotted versions numerically (1.10 > 1.9); pre-release suffixes sort before the release. */
export function compareVersions(a: string, b: string) {
	const parse = (v: string) => {
		const m = v.match(/^([\d.]+)(.*)$/)!;
		return { nums: m[1].split('.').map(Number), pre: m[2] };
	};
	const x = parse(a);
	const y = parse(b);
	for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
		const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
		if (d) return d;
	}
	if (x.pre === y.pre) return 0;
	if (!x.pre) return 1;
	if (!y.pre) return -1;
	return x.pre < y.pre ? -1 : 1;
}

type Row = {
	kind: ReleaseKind;
	version: string;
	filename: string;
	sha256: string;
	size: number;
	strict_min_version: string | null;
	notes: string | null;
	created_at: Date;
};
const fromRow = (r: Row): Release => ({
	kind: r.kind,
	version: r.version,
	filename: r.filename,
	sha256: r.sha256,
	size: r.size,
	strictMinVersion: r.strict_min_version,
	notes: r.notes,
	createdAt: r.created_at
});

export async function listReleases(kind?: ReleaseKind): Promise<Release[]> {
	const { rows } = await query<Row>(
		`SELECT kind, version, filename, sha256, size, strict_min_version, notes, created_at FROM releases
		 WHERE ($1::text IS NULL OR kind = $1) AND NOT yanked`,
		[kind ?? null]
	);
	return rows.map(fromRow).sort((a, b) => compareVersions(b.version, a.version));
}

export async function latest(kind: ReleaseKind): Promise<Release | null> {
	return (await listReleases(kind))[0] ?? null;
}

export type PublishResult =
	| { ok: true; release: Release; unchanged: boolean }
	| { ok: false; status: number; error: string };

export async function publishRelease(input: {
	kind: ReleaseKind;
	version: string;
	data: Uint8Array;
	strictMinVersion?: string | null;
	notes?: string | null;
	replace?: boolean;
}): Promise<PublishResult> {
	if (!VERSION.test(input.version)) return { ok: false, status: 400, error: 'invalid_version' };
	if (!input.data.byteLength) return { ok: false, status: 400, error: 'empty_body' };
	const sha256 = createHash('sha256').update(input.data).digest('hex');
	const filename = filenameFor(input.kind, input.version);

	const existing = (
		await query<Row>(
			`SELECT kind, version, filename, sha256, size, strict_min_version, notes, created_at FROM releases WHERE kind = $1 AND version = $2`,
			[input.kind, input.version]
		)
	).rows[0];
	if (existing && existing.sha256 === sha256) return { ok: true, release: fromRow(existing), unchanged: true };
	if (existing && !input.replace) return { ok: false, status: 409, error: 'version_exists_with_different_content' };

	const contentType = input.kind === 'extension' ? 'application/x-xpinstall' : 'application/gzip';
	await getStore().put('public', releaseObjectKey(filename), input.data, contentType);
	const { rows } = await query<Row>(
		`INSERT INTO releases (kind, version, filename, sha256, size, strict_min_version, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (kind, version) DO UPDATE SET sha256 = EXCLUDED.sha256, size = EXCLUDED.size,
		   strict_min_version = EXCLUDED.strict_min_version, notes = EXCLUDED.notes, created_at = now(), yanked = false
		 RETURNING kind, version, filename, sha256, size, strict_min_version, notes, created_at`,
		[input.kind, input.version, filename, sha256, input.data.byteLength, input.strictMinVersion ?? null, input.notes ?? null]
	);
	return { ok: true, release: fromRow(rows[0]), unchanged: false };
}

export async function findRelease(filename: string): Promise<Release | null> {
	const { rows } = await query<Row>(
		`SELECT kind, version, filename, sha256, size, strict_min_version, notes, created_at FROM releases WHERE filename = $1 AND NOT yanked`,
		[filename]
	);
	return rows[0] ? fromRow(rows[0]) : null;
}

/** Firefox's update manifest (https://extensionworkshop.com/documentation/manage/updating-your-extension/). */
export async function updateManifest() {
	const releases = await listReleases('extension');
	const updates = releases.map((r) => ({
		version: r.version,
		update_link: releaseUrl(r.filename),
		update_hash: `sha256:${r.sha256}`,
		applications: { gecko: { strict_min_version: r.strictMinVersion ?? '139.0' } }
	}));
	return { addons: Object.fromEntries(config.extensionIds.map((id) => [id, { updates }])) };
}
