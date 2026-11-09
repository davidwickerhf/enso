import { devicePoll } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) => devicePoll(request);
