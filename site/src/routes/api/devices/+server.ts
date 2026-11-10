import { devicesList } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) => devicesList(request);
