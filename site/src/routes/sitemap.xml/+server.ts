import { docs } from '$lib/server/docs';

const BASE = 'https://enso.wicker.life';

export const GET = () => {
	const paths = ['/', '/docs', '/privacy', ...docs.filter((d) => d.slug !== 'index').map((d) => `/docs/${d.slug}`)];
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
		.map((p) => `  <url><loc>${BASE}${p}</loc></url>`)
		.join('\n')}\n</urlset>\n`;
	return new Response(body, { headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' } });
};
