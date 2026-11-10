/**
 * Product screenshots in static/screenshots/. Each one exists in a light and a
 * dark version; the page shows the one matching the theme.
 *
 * They are captured from the real extension UI (the enso repo's extension/)
 * running on its in-page mock host, with the demo data swapped for a fictional
 * person ("Maya") so no real account, address or hostname appears. To retake
 * them, render the UI at the listed size and device scale 2, then export WebP.
 */
export type Screenshot = {
	/** file stem: /screenshots/<stem>-light…webp and -dark…webp */
	light: string;
	dark: string;
	/** optional larger file for high-density screens */
	light2x?: string;
	dark2x?: string;
	width: number;
	height: number;
	alt: string;
};

export const screenshots = {
	act: {
		light: '/screenshots/act-light-1600.webp',
		dark: '/screenshots/act-dark-1600.webp',
		light2x: '/screenshots/act-light-2880.webp',
		dark2x: '/screenshots/act-dark-2880.webp',
		width: 1600,
		height: 1000,
		alt: 'A resit registration form with the student number just typed in and outlined. Beside it, the Ensō sidebar lists its steps (read the page, typed into Student number) and asks before clicking Register, with Allow, Always allow and Deny.'
	},
	brief: {
		light: '/screenshots/brief-light.webp',
		dark: '/screenshots/brief-dark.webp',
		width: 960,
		height: 1032,
		alt: 'Your day, opened from a new tab: a one-line summary, today’s calendar, mail that needs an answer, and study deadlines.'
	},
	tools: {
		light: '/screenshots/sidebar-tools-light.webp',
		dark: '/screenshots/sidebar-tools-dark.webp',
		width: 800,
		height: 1800,
		alt: 'The sidebar answering “What matters today?”: it searched Gmail and listed today’s events, then shows a table of the day and the mail that needs you.'
	},
	spaces: {
		light: '/screenshots/sidebar-spaces-light.webp',
		dark: '/screenshots/sidebar-spaces-dark.webp',
		width: 800,
		height: 1800,
		alt: 'Typing @ in the sidebar lists the tabs in the current Zen space first, then tabs from other spaces, each labelled with its space.'
	},
	activity: {
		light: '/screenshots/activity-light-1600.webp',
		dark: '/screenshots/activity-dark-1600.webp',
		width: 1600,
		height: 954,
		alt: 'The Activity page: every click, typed field and selection Ensō made, grouped by day and site, each linked to its conversation. On the right, what it remembers about you, editable.'
	}
} satisfies Record<string, Screenshot>;
