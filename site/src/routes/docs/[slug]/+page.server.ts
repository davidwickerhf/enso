import { error, redirect } from '@sveltejs/kit';
import { getDoc, MOVED } from '$lib/server/docs';

export const load = ({ params }) => {
	if (params.slug === 'index') redirect(308, '/docs');
	if (MOVED[params.slug]) redirect(308, `/docs/${MOVED[params.slug]}`);
	const doc = getDoc(params.slug);
	if (!doc) error(404, 'This page does not exist.');
	return { doc };
};
