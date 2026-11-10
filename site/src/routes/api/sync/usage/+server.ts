import { syncUsage } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => syncUsage(request);
