import { error, redirect } from '@sveltejs/kit';
import { findRelease, latest, releaseUrl } from '$lib/server/releases';
import { getStore, releaseObjectKey } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const ALIASES: Record<string, 'extension' | 'helper'> = {
	'enso-latest.xpi': 'extension',
	'enso-helper-latest-darwin.tar.gz': 'helper'
};

/**
 * Release files. With S3 the bytes are public objects and this redirects to
 * them; without S3 they are streamed from Postgres. `enso-latest.xpi` and
 * `enso-helper-latest-darwin.tar.gz` always point at the newest version.
 */
export const GET: RequestHandler = async ({ params }) => {
	const alias = ALIASES[params.file];
	if (alias) {
		const r = await latest(alias);
		if (!r) error(404, 'No release published yet');
		redirect(302, releaseUrl(r.filename));
	}
	const release = await findRelease(params.file);
	if (!release) error(404, 'Not found');
	const store = getStore();
	const key = releaseObjectKey(release.filename);
	const direct = store.publicUrl(key);
	if (direct) redirect(302, direct);
	const data = await store.get('public', key);
	if (!data) error(404, 'Not found');
	return new Response(data as BodyInit, {
		headers: {
			'content-type': release.kind === 'extension' ? 'application/x-xpinstall' : 'application/gzip',
			'content-length': String(release.size),
			'content-disposition': `attachment; filename="${release.filename}"`,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-sha256': release.sha256
		}
	});
};
