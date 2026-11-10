import { fail, redirect } from '@sveltejs/kit';
import { getAuth, getSessionUser } from '$lib/server/auth';
import { createDeviceToken, listDevices, revokeDevice } from '$lib/server/devices';
import { clientIp } from '$lib/server/http';
import { hit } from '$lib/server/ratelimit';
import { safeRedirect, signOut } from '$lib/server/session';
import { deleteAccount, usage } from '$lib/server/sync';
import type { Actions, PageServerLoad } from './$types';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export const load: PageServerLoad = async ({ request, url }) => {
	const user = await getSessionUser(request.headers);
	const flags = { error: url.searchParams.get('error'), deleted: url.searchParams.has('deleted') };
	if (!user) return { user: null, ...flags };
	const [devices, storage] = await Promise.all([listDevices(user.id), usage(user.id)]);
	return {
		user: { email: user.email, createdAt: user.createdAt?.toISOString() ?? null },
		devices: devices.map((d) => ({
			id: d.id,
			name: d.name,
			createdAt: d.createdAt.toISOString(),
			lastUsedAt: d.lastUsedAt?.toISOString() ?? null
		})),
		storage,
		...flags
	};
};

export const actions: Actions = {
	signin: async ({ request, getClientAddress }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const next = safeRedirect(form.get('next'));
		if (!EMAIL.test(email)) return fail(400, { signinError: 'Enter a valid email address.', email });
		const limit = hit(`web-signin:${clientIp(request, getClientAddress())}`, 10, 15 * 60);
		if (!limit.ok) return fail(429, { signinError: 'Too many attempts. Try again in a few minutes.', email });
		try {
			await getAuth().api.signInMagicLink({
				body: { email, callbackURL: next, errorCallbackURL: '/account?error=link' },
				headers: request.headers
			});
		} catch (err) {
			console.error('signin: magic link failed', err instanceof Error ? err.message : err);
			return fail(500, { signinError: 'We could not send the email. Try again shortly.', email });
		}
		return { sent: email };
	},

	signout: async ({ request, cookies }) => {
		await signOut(request.headers, cookies);
		redirect(303, '/account');
	},

	addDevice: async ({ request }) => {
		const user = await getSessionUser(request.headers);
		if (!user) return fail(401, { deviceError: 'Sign in first.' });
		const form = await request.formData();
		const { token, device } = await createDeviceToken(user.id, String(form.get('name') ?? ''));
		return { newToken: token, newTokenDevice: device.name };
	},

	revoke: async ({ request }) => {
		const user = await getSessionUser(request.headers);
		if (!user) return fail(401, { deviceError: 'Sign in first.' });
		const form = await request.formData();
		const ok = await revokeDevice(user.id, String(form.get('id') ?? ''));
		return ok ? { revoked: true } : fail(404, { deviceError: 'That device was already removed.' });
	},

	delete: async ({ request, cookies }) => {
		const user = await getSessionUser(request.headers);
		if (!user) return fail(401, { deleteError: 'Sign in first.' });
		const form = await request.formData();
		if (String(form.get('confirm') ?? '').trim().toLowerCase() !== user.email.toLowerCase()) {
			return fail(400, { deleteError: 'Type your email address exactly to confirm.' });
		}
		await deleteAccount(user.id);
		await signOut(request.headers, cookies);
		redirect(303, '/account?deleted=1');
	}
};
