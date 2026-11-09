import { fail, redirect } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth';
import { decideDeviceRequest, getDeviceRequest } from '$lib/server/devices';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ request, url }) => {
	const id = url.searchParams.get('request') ?? '';
	const user = await getSessionUser(request.headers);
	if (!user) redirect(303, `/account?next=${encodeURIComponent(`/account/approve?request=${id}`)}`);
	const req = await getDeviceRequest(id);
	if (!req) return { state: 'missing' as const };
	if (req.email !== user.email.toLowerCase()) return { state: 'other-account' as const };
	if (req.status !== 'pending') return { state: req.status === 'denied' ? ('denied' as const) : ('done' as const) };
	if (req.expired) return { state: 'expired' as const };
	return {
		state: 'pending' as const,
		request: { id: req.id, deviceName: req.deviceName, userCode: req.userCode, ip: req.ip, createdAt: req.createdAt.toISOString() }
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const user = await getSessionUser(request.headers);
		if (!user) return fail(401, { error: 'Sign in first.' });
		const form = await request.formData();
		const decision = form.get('decision') === 'approve' ? 'approved' : 'denied';
		const ok = await decideDeviceRequest(String(form.get('id') ?? ''), user, decision);
		if (!ok) return fail(409, { error: 'This request has expired or was already answered.' });
		return { decided: decision };
	}
};
