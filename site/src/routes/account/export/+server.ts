import { error } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/auth';
import { listDevices } from '$lib/server/devices';
import { exportBlobs, usage } from '$lib/server/sync';
import type { RequestHandler } from './$types';

/**
 * Everything the server holds for this account, streamed as one JSON file.
 * Blob contents are base64 ciphertext, exactly as uploaded.
 */
export const GET: RequestHandler = async ({ request }) => {
	const user = await getSessionUser(request.headers);
	if (!user) error(401, 'Sign in first');
	const [devices, storage] = await Promise.all([listDevices(user.id), usage(user.id)]);
	const head = {
		format: 'enso-sync-export-v1',
		exportedAt: new Date().toISOString(),
		account: { id: user.id, email: user.email, createdAt: user.createdAt },
		storage,
		devices,
		note: 'Blob data is end-to-end encrypted. Only a device with your account key or recovery phrase can decrypt it.'
	};
	const encoder = new TextEncoder();
	const iterator = exportBlobs(user.id);
	let first = true;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const json = JSON.stringify(head);
			controller.enqueue(encoder.encode(json.slice(0, -1) + ',"blobs":['));
		},
		async pull(controller) {
			const { value, done } = await iterator.next();
			if (done) {
				controller.enqueue(encoder.encode(']}\n'));
				controller.close();
				return;
			}
			const entry = { ...value, data: value.data ? Buffer.from(value.data).toString('base64') : null };
			controller.enqueue(encoder.encode((first ? '' : ',') + JSON.stringify(entry)));
			first = false;
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="enso-export-${new Date().toISOString().slice(0, 10)}.json"`,
			'cache-control': 'no-store'
		}
	});
};
