import { latestVersions } from '$lib/server/api';
import type { RequestHandler } from './$types';

/** Newest extension and helper; ?platform=darwin|linux|win32 picks the helper (default darwin). */
export const GET: RequestHandler = ({ request }) => latestVersions(request);
