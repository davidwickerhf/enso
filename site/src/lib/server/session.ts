import type { Cookies } from '@sveltejs/kit';
import { getAuth } from './auth';

const COOKIES = ['better-auth.session_token', 'better-auth.session_data', 'better-auth.dont_remember'];

/** Ends the web session: revokes it server-side, then clears the cookies. */
export async function signOut(headers: Headers, cookies: Cookies) {
	try {
		await getAuth().api.signOut({ headers });
	} catch {
		/* already gone */
	}
	for (const name of COOKIES) {
		cookies.delete(name, { path: '/' });
		cookies.delete(`__Secure-${name}`, { path: '/', secure: true });
	}
}

/** Only same-site relative paths are allowed as post-sign-in destinations. */
export function safeRedirect(value: unknown, fallback = '/account') {
	const s = String(value ?? '');
	return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : fallback;
}
