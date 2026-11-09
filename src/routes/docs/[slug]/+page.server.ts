import { error, redirect } from '@sveltejs/kit';
import { getDoc } from '$lib/server/docs';

export const load = ({ params }) => {
	if (params.slug === 'index') redirect(308, '/docs');
	const doc = getDoc(params.slug);
	if (!doc) error(404, 'This page does not exist.');
	return { doc };
};
