import { syncManifest } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => syncManifest(request);
