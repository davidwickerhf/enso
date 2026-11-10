import { firefoxLink } from '$lib/server/firefox';

/** Every page gets where "Get it for Firefox" points (see $lib/server/firefox). */
export const load = async () => ({ firefox: await firefoxLink() });
