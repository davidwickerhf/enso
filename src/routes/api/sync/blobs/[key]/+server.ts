import { syncDelete, syncGet, syncPut } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request, params }) => syncGet(request, params.key);
export const PUT: RequestHandler = ({ request, params }) => syncPut(request, params.key);
export const DELETE: RequestHandler = ({ request, params }) => syncDelete(request, params.key);
