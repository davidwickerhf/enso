import { error, redirect } from '@sveltejs/kit';
import { findRelease, latest, latestDirect, releaseUrl } from '$lib/server/releases';
import { getStore, releaseObjectKey } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const ALIASES: Record<string, ['extension' | 'helper', ('darwin' | 'linux' | 'win32' | 'any')?]> = {
	'enso-latest.xpi': ['extension'],
	'enso-helper-latest-darwin.tar.gz': ['helper', 'darwin'],
	'enso-helper-latest-linux.tar.gz': ['helper', 'linux'],
	'enso-helper-latest-win32.tar.gz': ['helper', 'win32'],
	'enso-helper-latest.tar.gz': ['helper', 'any']
};

/**
 * Release files. With S3 the bytes are public objects and this redirects to
 * them; without S3 they are streamed from Postgres. `enso-latest.xpi` points
 * at the newest direct-download extension (a four-part version such as 0.5.7.1,
 * see latestDirect), `enso-helper-latest[-darwin|-linux|-win32].tar.gz` at the
 * newest helper (for that platform).
 */
export const GET: RequestHandler = async ({ params }) => {
	const alias = ALIASES[params.file];
	if (alias) {
		const r = params.file === 'enso-latest.xpi' ? await latestDirect() : await latest(alias[0], alias[1]);
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
