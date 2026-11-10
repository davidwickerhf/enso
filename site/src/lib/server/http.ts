import { config } from './config';
import { authenticateDevice, type DeviceAuth } from './devices';
import { hit } from './ratelimit';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
	});

export const problem = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
	json({ error, ...extra }, status, headers);

/** Client address as seen behind Traefik. */
export function clientIp(request: Request, fallback = 'unknown') {
	return request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || fallback;
}

/** Authenticates a device token and applies the per-device rate limit. */
export async function requireDevice(request: Request): Promise<DeviceAuth | Response> {
	const device = await authenticateDevice(request.headers.get('authorization'));
	if (!device) return problem(401, 'unauthorized', {}, { 'www-authenticate': 'Bearer realm="enso-sync"' });
	const limit = hit(`sync:${device.deviceId}`, config.syncRateLimit, 60);
	if (!limit.ok) return problem(429, 'rate_limited', { retryAfter: limit.retryAfter }, { 'retry-after': String(limit.retryAfter) });
	return device;
}

/** Reads a request body up to `max` bytes; returns null when it is larger. */
export async function readBody(request: Request, max: number): Promise<Uint8Array | null> {
	const declared = Number(request.headers.get('content-length') ?? NaN);
	if (Number.isFinite(declared) && declared > max) return null;
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}

/** Parses `"3"` / `W/"3"` / `3` into a version number. */
export function parseVersionTag(value: string | null): number | null {
	if (!value) return null;
	const m = value.trim().match(/^(?:W\/)?"?(\d{1,15})"?$/);
	return m ? Number(m[1]) : null;
}

export const etag = (version: number) => `"${version}"`;

/** Constant-time comparison for the release token. */
export function safeEqual(a: string, b: string) {
	if (!a || !b || a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
