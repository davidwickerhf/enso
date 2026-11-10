import { json } from '$lib/server/http';
import { updateManifest } from '$lib/server/releases';

/** Firefox update manifest; the extension's manifest points update_url here. */
export const GET = async () => json(await updateManifest(), 200, { 'cache-control': 'public, max-age=300' });
