/**
 * Product screenshots. To swap a placeholder for the real thing, put the
 * image in static/screenshots/ and set `src` (and check `alt`). Sizes are the
 * recommended capture sizes; any image with the same aspect ratio works.
 */
export type Screenshot = { src: string | null; alt: string; caption: string; ratio: string; size: string };

export const screenshots = {
	hero: {
		src: null,
		alt: 'Zen with the Ensō sidebar open beside an article, answering a question about the page',
		caption: 'The sidebar beside an article',
		ratio: '16 / 10',
		size: '2880 × 1800'
	},
	sidebar: {
		src: null,
		alt: 'The Ensō sidebar with a conversation and a page chip',
		caption: 'Sidebar chat',
		ratio: '4 / 5',
		size: '1200 × 1500'
	},
	newtab: {
		src: null,
		alt: 'The new-tab page showing the morning brief: calendar, mail and deadlines',
		caption: 'New tab: your brief',
		ratio: '4 / 5',
		size: '1200 × 1500'
	},
	fullpage: {
		src: null,
		alt: 'The full-page app with conversation history and a report',
		caption: 'Full page',
		ratio: '4 / 5',
		size: '1200 × 1500'
	},
	approval: {
		src: null,
		alt: 'An approval card asking before Ensō sends an email, with Allow, Always allow and Deny',
		caption: 'Asking before it acts',
		ratio: '4 / 3',
		size: '1600 × 1200'
	}
} satisfies Record<string, Screenshot>;
