import { error } from '@sveltejs/kit';
import { getPage } from '$lib/server/docs';

export const load = () => {
	const doc = getPage('privacy');
	if (!doc) error(404, 'Not found');
	return { doc };
};
