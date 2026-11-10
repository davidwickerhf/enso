import { releasePut } from '$lib/server/api';
import type { RequestHandler } from './$types';

/** CI publishes a signed .xpi or a helper tarball (bearer RELEASE_TOKEN). */
export const PUT: RequestHandler = ({ request, params }) => releasePut(request, params.kind, params.version);
