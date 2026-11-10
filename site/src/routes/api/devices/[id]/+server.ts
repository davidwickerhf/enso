import { deviceRevoke } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ request, params }) => deviceRevoke(request, params.id);
