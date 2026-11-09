import { accountDelete } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = ({ request }) => accountDelete(request);
