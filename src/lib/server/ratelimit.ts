/**
 * Fixed-window rate limits kept in memory. Ensō runs as a single container
 * (one replica), so this is enough; it resets on deploy, which is fine.
 */
type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

export type Limit = { ok: true; remaining: number } | { ok: false; retryAfter: number };

export function hit(key: string, max: number, windowSeconds: number, now = Date.now()): Limit {
	let w = windows.get(key);
	if (!w || w.resetAt <= now) {
		w = { count: 0, resetAt: now + windowSeconds * 1000 };
		windows.set(key, w);
	}
	w.count++;
	if (windows.size > 50_000) sweep(now);
	return w.count <= max ? { ok: true, remaining: max - w.count } : { ok: false, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
}

function sweep(now: number) {
	for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}

export function resetLimits() {
	windows.clear();
}
