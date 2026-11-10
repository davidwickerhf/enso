import { deviceStart } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => deviceStart(request);
