import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytes, req } from './helpers';
import { latestVersions, releasePut } from '$lib/server/api';
import { compareVersions, updateManifest } from '$lib/server/releases';
import { getStore, releaseObjectKey } from '$lib/server/storage';

const publish = (kind: string, version: string, data: Uint8Array, token = 'test-release-token', qs = '') =>
	releasePut(req('PUT', `/api/releases/${kind}/${version}${qs}`, { token, body: data }), kind, version);

describe('releases and the update feed', () => {
	it('requires the release token', async () => {
		expect((await publish('extension', '0.3.0', bytes(10), 'wrong')).status).toBe(401);
		expect((await publish('extension', '0.3.0', bytes(10), '')).status).toBe(401);
	});

	it('publishes an xpi and lists it in Firefox update-manifest format', async () => {
		const xpi = bytes(100, 9);
		const res = await publish('extension', '0.3.0', xpi, undefined, '?strict_min_version=139.0');
		expect(res.status).toBe(201);
		const body = await res.json();
		const sha = createHash('sha256').update(xpi).digest('hex');
		expect(body).toMatchObject({ version: '0.3.0', sha256: sha, url: 'http://localhost:5173/releases/enso-0.3.0.xpi' });

		const stored = await getStore().get('public', releaseObjectKey('enso-0.3.0.xpi'));
		expect(stored).toEqual(xpi);

		const manifest = await updateManifest();
		expect(manifest).toEqual({
			addons: {
				'enso@wicker.life': {
					updates: [
						{
							version: '0.3.0',
							update_link: 'http://localhost:5173/releases/enso-0.3.0.xpi',
							update_hash: `sha256:${sha}`,
							applications: { gecko: { strict_min_version: '139.0' } }
						}
					]
				}
			}
		});
	});

	it('answers for every configured add-on id', async () => {
		process.env.EXTENSION_IDS = 'enso@wicker.life, zen-chat@wicker.life';
		try {
			await publish('extension', '1.0.0', bytes(5));
			const manifest = await updateManifest();
			expect(Object.keys(manifest.addons)).toEqual(['enso@wicker.life', 'zen-chat@wicker.life']);
		} finally {
			delete process.env.EXTENSION_IDS;
		}
	});

	it('is idempotent for identical uploads and refuses to change a published version', async () => {
		expect((await publish('helper', '0.3.0', bytes(50, 1))).status).toBe(201);
		const same = await publish('helper', '0.3.0', bytes(50, 1));
		expect(same.status).toBe(200);
		expect((await same.json()).unchanged).toBe(true);
		expect((await publish('helper', '0.3.0', bytes(50, 2))).status).toBe(409);
		expect((await publish('helper', '0.3.0', bytes(50, 2), undefined, '?replace=1')).status).toBe(201);
	});

	it('rejects bad kinds and versions', async () => {
		expect((await publish('plugin', '1.0.0', bytes(5))).status).toBe(400);
		expect((await publish('extension', 'latest', bytes(5))).status).toBe(400);
		expect((await publish('extension', '1.0.0', new Uint8Array())).status).toBe(400);
	});

	it('reports the newest versions, comparing numerically', async () => {
		await publish('extension', '0.9.0', bytes(5, 1));
		await publish('extension', '0.10.0', bytes(5, 2));
		await publish('extension', '0.10.0-beta.1', bytes(5, 3));
		await publish('helper', '0.10.0', bytes(5, 4));
		const res = await latestVersions();
		const body = await res.json();
		expect(body.extension.version).toBe('0.10.0');
		expect(body.helper.url).toBe('http://localhost:5173/releases/enso-helper-0.10.0-darwin.tar.gz');
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		const versions = (await updateManifest()).addons['enso@wicker.life'].updates.map((u) => u.version);
		expect(versions).toEqual(['0.10.0', '0.10.0-beta.1', '0.9.0']);
	});

	it('serves the helper per platform, with old macOS installers unchanged', async () => {
		const latestFor = async (platform?: string) =>
			(await latestVersions(req('GET', `/api/latest${platform ? `?platform=${platform}` : ''}`))).json();
		// An older release, as CI published it before platforms existed (no ?platform= → darwin).
		await publish('helper', '1.1.0', bytes(5, 10));
		// The universal archive, for every OS.
		const any = await publish('helper', '1.2.0', bytes(5, 11), undefined, '?platform=any');
		expect(any.status).toBe(201);
		expect(await any.json()).toMatchObject({ platform: 'any', url: 'http://localhost:5173/releases/enso-helper-1.2.0.tar.gz' });
		for (const p of [undefined, 'darwin', 'linux', 'win32']) {
			const body = await latestFor(p);
			expect(body.helper).toMatchObject({ version: '1.2.0', platform: 'any' });
		}
		// A platform build of the same version wins for that platform only.
		await publish('helper', '1.2.0', bytes(5, 12), undefined, '?platform=win32');
		const body = await latestFor('win32');
		expect(body.helper).toMatchObject({ version: '1.2.0', platform: 'win32', url: 'http://localhost:5173/releases/enso-helper-1.2.0-win32.tar.gz' });
		expect(body.helpers.win32.platform).toBe('win32');
		expect(body.helpers.linux.platform).toBe('any');
		expect(body.helpers.darwin.platform).toBe('any');
		expect((await latestFor()).helper.platform).toBe('any');
		// An unknown ?platform= on GET falls back to darwin; on PUT it is refused.
		expect((await latestFor('beos')).helper.platform).toBe('any');
		expect((await publish('helper', '1.3.0', bytes(5, 13), undefined, '?platform=beos')).status).toBe(400);
		// The extension ignores platforms.
		expect((await (await publish('extension', '1.2.0', bytes(5, 14), undefined, '?platform=linux')).json()).platform).toBe('any');
	});

	it('orders versions like Firefox does for the common cases', () => {
		expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
		expect(compareVersions('1.0', '1.0.0')).toBe(0);
		expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
	});
});
