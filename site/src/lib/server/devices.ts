/**
 * Per-device bearer tokens and the device sign-in flow.
 *
 * Tokens look like `enso_<43 base64url chars>` (256 random bits). Only their
 * SHA-256 is stored, so a database leak does not leak usable tokens.
 *
 * Device flow (what Ensō does when you turn on sync):
 *   1. POST /api/device/start {email, deviceName} -> {deviceCode, userCode}
 *      and a magic link is mailed to the address.
 *   2. The link signs the user in on the web and opens /account/approve,
 *      which shows the device name and userCode; the user approves.
 *   3. Ensō polls POST /api/device/poll {deviceCode}; once approved it gets
 *      its token exactly once.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { query } from './db';

const TOKEN_PREFIX = 'enso_';
const REQUEST_TTL_SECONDS = 15 * 60;
export const POLL_INTERVAL_SECONDS = 3;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function userCode() {
	let s = '';
	for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
	return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export type Device = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null };

export function cleanDeviceName(raw: unknown): string {
	const name = String(raw ?? '')
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.trim()
		.slice(0, 80);
	return name || 'Unnamed device';
}

export async function createDeviceToken(userId: string, name: string): Promise<{ token: string; device: Device }> {
	const token = TOKEN_PREFIX + randomToken();
	const { rows } = await query<{ id: string; name: string; created_at: Date }>(
		`INSERT INTO devices (user_id, name, token_hash) VALUES ($1, $2, $3) RETURNING id, name, created_at`,
		[userId, cleanDeviceName(name), sha256(token)]
	);
	const row = rows[0];
	return { token, device: { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: null } };
}

export type DeviceAuth = { userId: string; deviceId: string; deviceName: string };

/** Resolves `Authorization: Bearer enso_…` to a live device, or null. */
export async function authenticateDevice(authorization: string | null): Promise<DeviceAuth | null> {
	const match = authorization?.match(/^Bearer\s+(enso_[A-Za-z0-9_-]{43})$/);
	if (!match) return null;
	const { rows } = await query<{ id: string; user_id: string; name: string; last_used_at: Date | null }>(
		`SELECT id, user_id, name, last_used_at FROM devices WHERE token_hash = $1 AND revoked_at IS NULL`,
		[sha256(match[1])]
	);
	const row = rows[0];
	if (!row) return null;
	if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 5 * 60_000) {
		await query(`UPDATE devices SET last_used_at = now() WHERE id = $1`, [row.id]);
	}
	return { userId: row.user_id, deviceId: row.id, deviceName: row.name };
}

export async function listDevices(userId: string): Promise<Device[]> {
	const { rows } = await query<{ id: string; name: string; created_at: Date; last_used_at: Date | null }>(
		`SELECT id, name, created_at, last_used_at FROM devices
		 WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
		[userId]
	);
	return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

/** Revokes a device of this user. Returns false if there was nothing to revoke. */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
	if (!/^[0-9a-f-]{36}$/i.test(deviceId)) return false;
	const { rowCount } = await query(
		`UPDATE devices SET revoked_at = now(), token_hash = 'revoked:' || id
		 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
		[deviceId, userId]
	);
	return (rowCount ?? 0) > 0;
}

// ---------- device flow ----------

export async function startDeviceRequest(input: { email: string; deviceName: string; ip?: string }) {
	const deviceCode = randomToken();
	const code = userCode();
	const { rows } = await query<{ id: string }>(
		`INSERT INTO device_requests (device_code_hash, user_code, email, device_name, ip, expires_at)
		 VALUES ($1, $2, lower($3), $4, $5, now() + make_interval(secs => $6)) RETURNING id`,
		[sha256(deviceCode), code, input.email, cleanDeviceName(input.deviceName), input.ip ?? null, REQUEST_TTL_SECONDS]
	);
	return {
		id: rows[0].id,
		deviceCode,
		userCode: code,
		expiresIn: REQUEST_TTL_SECONDS,
		interval: POLL_INTERVAL_SECONDS
	};
}

export type PendingRequest = {
	id: string;
	email: string;
	deviceName: string;
	userCode: string;
	ip: string | null;
	createdAt: Date;
	status: string;
	expired: boolean;
};

export async function getDeviceRequest(id: string): Promise<PendingRequest | null> {
	if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
	const { rows } = await query<{
		id: string;
		email: string;
		device_name: string;
		user_code: string;
		ip: string | null;
		created_at: Date;
		status: string;
		expired: boolean;
	}>(
		`SELECT id, email, device_name, user_code, ip, created_at, status, expires_at < now() AS expired
		 FROM device_requests WHERE id = $1`,
		[id]
	);
	const r = rows[0];
	return r
		? {
				id: r.id,
				email: r.email,
				deviceName: r.device_name,
				userCode: r.user_code,
				ip: r.ip,
				createdAt: r.created_at,
				status: r.status,
				expired: r.expired
			}
		: null;
}

/** Device name and code for the sign-in email, looked up from the link's callback URL. */
export async function deviceRequestForMail(link: string): Promise<{ name: string; code: string } | null> {
	try {
		const callback = new URL(link).searchParams.get('callbackURL');
		if (!callback) return null;
		const cb = new URL(callback, 'http://x');
		if (cb.pathname !== '/account/approve') return null;
		const req = await getDeviceRequest(cb.searchParams.get('request') ?? '');
		return req && req.status === 'pending' && !req.expired ? { name: req.deviceName, code: req.userCode } : null;
	} catch {
		return null;
	}
}

/** Approve or deny a pending request. Only the owner of the requested email address may decide. */
export async function decideDeviceRequest(
	id: string,
	user: { id: string; email: string },
	decision: 'approved' | 'denied'
): Promise<boolean> {
	const { rowCount } = await query(
		`UPDATE device_requests SET status = $3, user_id = $2, decided_at = now()
		 WHERE id = $1 AND status = 'pending' AND expires_at > now() AND email = lower($4)`,
		[id, user.id, decision, user.email]
	);
	return (rowCount ?? 0) > 0;
}

export type PollResult =
	| { status: 'pending' | 'denied' | 'expired' }
	| { status: 'approved'; token: string; device: Device };

/** Exchanges an approved request for a device token, once. */
export async function pollDeviceRequest(deviceCode: string): Promise<PollResult> {
	if (typeof deviceCode !== 'string' || deviceCode.length < 20) return { status: 'expired' };
	// Claim atomically (row lock) so two polls can never mint two tokens.
	const { rows } = await query<{ status: string; expired: boolean; user_id: string | null; device_name: string }>(
		`WITH old AS (
		   SELECT id, status, expires_at < now() AS expired, user_id, device_name
		   FROM device_requests WHERE device_code_hash = $1 FOR UPDATE
		 ), claim AS (
		   UPDATE device_requests d SET status = 'consumed'
		   FROM old WHERE d.id = old.id AND old.status = 'approved'
		 )
		 SELECT status, expired, user_id, device_name FROM old`,
		[sha256(deviceCode)]
	);
	const r = rows[0];
	if (!r) return { status: 'expired' };
	if (r.status === 'approved' && r.user_id) {
		const { token, device } = await createDeviceToken(r.user_id, r.device_name);
		return { status: 'approved', token, device };
	}
	if (r.status === 'denied') return { status: 'denied' };
	if (r.status === 'consumed' || r.expired) return { status: 'expired' };
	return { status: 'pending' };
}
