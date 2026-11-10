/**
 * HTTP handlers for the JSON/binary API, written against plain Request
 * objects so the tests can call them without a running server. The route
 * files under src/routes/api are one-line wrappers around these.
 */
import { getAuth } from './auth';
import { config } from './config';
import { query } from './db';
import { listDevices, pollDeviceRequest, revokeDevice, startDeviceRequest } from './devices';
import { clientIp, etag, json, parseVersionTag, problem, readBody, requireDevice, safeEqual } from './http';
import { hit } from './ratelimit';
import { HELPER_PLATFORMS, KINDS, PLATFORMS, publishRelease, releaseUrl, type ReleaseKind, type ReleasePlatform, latest } from './releases';
import { BLOB_KEY, deleteAccount, deleteBlob, getBlob, manifest, putBlob, usage } from './sync';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function readJson(request: Request, max = 16 * 1024): Promise<Record<string, unknown> | null> {
	const body = await readBody(request, max);
	if (!body) return null;
	try {
		const value = JSON.parse(new TextDecoder().decode(body));
		return value && typeof value === 'object' ? value : null;
	} catch {
		return null;
	}
}

// ---------- sync ----------

export async function syncPut(request: Request, key: string) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	if (!BLOB_KEY.test(key)) return problem(400, 'invalid_key');
	const data = await readBody(request, config.maxBlobBytes);
	if (!data) return problem(413, 'too_large', { maxBytes: config.maxBlobBytes });

	const ifNoneMatch = request.headers.get('if-none-match');
	const ifMatchRaw = request.headers.get('if-match');
	const ifMatch = parseVersionTag(ifMatchRaw);
	if (ifMatchRaw && ifMatch == null) return problem(400, 'invalid_if_match');

	const result = await putBlob(device.userId, device.deviceId, key, data, {
		ifMatch,
		ifNoneMatchAny: ifNoneMatch?.trim() === '*'
	});
	if (result.ok) {
		return json({ key, version: result.version, size: result.size }, result.created ? 201 : 200, { etag: etag(result.version) });
	}
	switch (result.error) {
		case 'precondition_required':
			return problem(428, 'precondition_required', {
				hint: 'Send If-Match: "<version>" to update, or If-None-Match: * to create.'
			});
		case 'precondition_failed':
			return problem(
				412,
				'version_conflict',
				{ currentVersion: result.currentVersion },
				result.currentVersion != null ? { etag: etag(result.currentVersion) } : {}
			);
		case 'quota_exceeded':
			return problem(507, 'quota_exceeded', { usedBytes: result.usedBytes, quotaBytes: result.quotaBytes });
		case 'too_large':
			return problem(413, 'too_large', { maxBytes: result.maxBytes });
	}
}

export async function syncGet(request: Request, key: string) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	if (!BLOB_KEY.test(key)) return problem(400, 'invalid_key');
	const blob = await getBlob(device.userId, key);
	if (!blob) return problem(404, 'not_found');
	const tag = etag(blob.version);
	if (parseVersionTag(request.headers.get('if-none-match')) === blob.version) {
		return new Response(null, { status: 304, headers: { etag: tag, 'cache-control': 'no-store' } });
	}
	return new Response(blob.data as BodyInit, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(blob.size),
			etag: tag,
			'last-modified': blob.updatedAt.toUTCString(),
			'cache-control': 'no-store'
		}
	});
}

export async function syncDelete(request: Request, key: string) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	if (!BLOB_KEY.test(key)) return problem(400, 'invalid_key');
	const result = await deleteBlob(device.userId, key, parseVersionTag(request.headers.get('if-match')));
	if (result.ok) return json({ key, version: result.version, deleted: true }, 200, { etag: etag(result.version) });
	if (result.error === 'not_found') return problem(404, 'not_found');
	return problem(412, 'version_conflict', { currentVersion: result.currentVersion }, { etag: etag(result.currentVersion) });
}

export async function syncManifest(request: Request) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	const url = new URL(request.url);
	const since = Number(url.searchParams.get('since') ?? 0);
	const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 1000), 1), 5000);
	if (!Number.isSafeInteger(since) || since < 0 || !Number.isFinite(limit)) return problem(400, 'invalid_cursor');
	const [m, u] = await Promise.all([manifest(device.userId, since, Math.floor(limit)), usage(device.userId)]);
	return json({ ...m, usage: u });
}

export async function syncUsage(request: Request) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	return json(await usage(device.userId));
}

// ---------- devices ----------

export async function devicesList(request: Request) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	const devices = await listDevices(device.userId);
	return json({ devices: devices.map((d) => ({ ...d, current: d.id === device.deviceId })) });
}

export async function deviceRevoke(request: Request, id: string) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	return (await revokeDevice(device.userId, id)) ? json({ revoked: true }) : problem(404, 'not_found');
}

export async function deviceStart(request: Request) {
	const body = await readJson(request);
	const email = String(body?.email ?? '').trim().toLowerCase();
	if (!EMAIL.test(email)) return problem(400, 'invalid_email');
	const ip = clientIp(request);
	for (const [k, max] of [
		[`device-start:ip:${ip}`, 10],
		[`device-start:email:${email}`, 5]
	] as const) {
		const limit = hit(k, max, 15 * 60);
		if (!limit.ok) return problem(429, 'rate_limited', { retryAfter: limit.retryAfter }, { 'retry-after': String(limit.retryAfter) });
	}
	const req = await startDeviceRequest({ email, deviceName: String(body?.deviceName ?? ''), ip: ip === 'unknown' ? undefined : ip });
	await getAuth().api.signInMagicLink({
		body: { email, callbackURL: `/account/approve?request=${req.id}` },
		headers: request.headers
	});
	return json({ deviceCode: req.deviceCode, userCode: req.userCode, expiresIn: req.expiresIn, interval: req.interval });
}

export async function devicePoll(request: Request) {
	const body = await readJson(request);
	const deviceCode = String(body?.deviceCode ?? '');
	const limit = hit(`device-poll:${deviceCode.slice(0, 16)}`, 40, 60);
	if (!limit.ok) return problem(429, 'slow_down', { retryAfter: limit.retryAfter });
	const result = await pollDeviceRequest(deviceCode);
	if (result.status === 'approved') {
		return json({ status: 'approved', token: result.token, device: { id: result.device.id, name: result.device.name } });
	}
	return json({ status: result.status }, result.status === 'pending' ? 202 : 410);
}

// ---------- account ----------

/** DELETE /api/account with a device token and {"confirm":"delete"}: removes the account and every blob. */
export async function accountDelete(request: Request) {
	const device = await requireDevice(request);
	if (device instanceof Response) return device;
	const body = await readJson(request);
	if (body?.confirm !== 'delete') return problem(400, 'confirmation_required', { hint: 'Send {"confirm":"delete"}.' });
	const result = await deleteAccount(device.userId);
	return json({ deleted: true, ...result });
}

// ---------- releases ----------

export async function releasePut(request: Request, kind: string, version: string) {
	const auth = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/)?.[1] ?? '';
	if (!config.releaseToken || !safeEqual(auth, config.releaseToken)) return problem(401, 'unauthorized');
	if (!KINDS.includes(kind as ReleaseKind)) return problem(400, 'invalid_kind', { kinds: KINDS });
	const data = await readBody(request, config.maxReleaseBytes);
	if (!data) return problem(413, 'too_large', { maxBytes: config.maxReleaseBytes });
	const url = new URL(request.url);
	const platform = url.searchParams.get('platform');
	if (platform !== null && !PLATFORMS.includes(platform as ReleasePlatform)) return problem(400, 'invalid_platform', { platforms: PLATFORMS });
	const notes = request.headers.get('x-release-notes');
	const result = await publishRelease({
		kind: kind as ReleaseKind,
		version,
		platform: (platform as ReleasePlatform | null) ?? undefined,
		data,
		strictMinVersion: url.searchParams.get('strict_min_version'),
		notes: notes ? decodeURIComponent(notes).slice(0, 2000) : null,
		replace: url.searchParams.get('replace') === '1'
	});
	if (!result.ok) return problem(result.status, result.error);
	const r = result.release;
	return json(
		{ kind: r.kind, version: r.version, platform: r.platform, url: releaseUrl(r.filename), sha256: r.sha256, size: r.size, unchanged: result.unchanged },
		result.unchanged ? 200 : 201
	);
}

/**
 * GET /api/latest[?platform=darwin|linux|win32]. `helper` is the helper for
 * that platform (default darwin, which is what installers before Linux and
 * Windows support expect); `helpers` lists every platform.
 */
export async function latestVersions(request?: Request) {
	const asked = request ? new URL(request.url).searchParams.get('platform') : null;
	const platform = (HELPER_PLATFORMS as string[]).includes(asked ?? '') ? (asked as (typeof HELPER_PLATFORMS)[number]) : 'darwin';
	const [ext, helper, ...perPlatform] = await Promise.all([latest('extension'), latest('helper', platform), ...HELPER_PLATFORMS.map((p) => latest('helper', p))]);
	const view = (r: Awaited<ReturnType<typeof latest>>) =>
		r ? { version: r.version, platform: r.platform, url: releaseUrl(r.filename), sha256: r.sha256, size: r.size, publishedAt: r.createdAt.toISOString() } : null;
	const helpers = Object.fromEntries(HELPER_PLATFORMS.map((p, i) => [p, view(perPlatform[i])]));
	return json({ extension: view(ext), helper: view(helper), helpers, extensionIds: config.extensionIds }, 200, {
		'cache-control': 'public, max-age=300',
		'access-control-allow-origin': '*'
	});
}

export async function health() {
	try {
		await query('SELECT 1');
		return json({ ok: true, db: 'ok', storage: config.storageDriver });
	} catch {
		return json({ ok: false, db: 'unreachable' }, 503);
	}
}
