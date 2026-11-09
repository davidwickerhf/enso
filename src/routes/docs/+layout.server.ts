import { docNav } from '$lib/server/docs';

export const load = () => ({ nav: docNav() });
