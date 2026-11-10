import { error } from '@sveltejs/kit';
import { getDoc } from '$lib/server/docs';

export const load = () => {
	const doc = getDoc('index');
	if (!doc) error(404, 'Not found');
	return { doc };
};
