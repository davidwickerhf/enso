<script lang="ts" module>
	// The extension's own hand-drawn 24×24 stroke icons (chat/extension/ui/icons.js),
	// so the recreated UI uses exactly the app's glyphs.
	export const ICONS = {
		plus: ['M12 5v14', 'M5 12h14'],
		x: ['M6 6l12 12', 'M18 6L6 18'],
		chevronRight: ['M9.5 6l6 6-6 6'],
		arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
		history: ['M4.5 12a7.5 7.5 0 102.2-5.3', 'M4 4.5v3.5h3.5', 'M12 8v4l2.5 1.5'],
		search: ['circle:11,11,6', 'M15.5 15.5L20 20'],
		sliders: ['M4 7h9', 'M17 7h3', 'circle:15,7,2', 'M4 17h3', 'M11 17h9', 'circle:9,17,2'],
		mail: ['M4 6.5h16v11H4z', 'M4.5 7l7.5 6 7.5-6'],
		calendar: ['M5 6h14v13H5z', 'M5 10h14', 'M9 4v4', 'M15 4v4'],
		book: ['M5 5.5A1.5 1.5 0 016.5 4H19v13H6.5A1.5 1.5 0 005 18.5z', 'M5 18.5A1.5 1.5 0 006.5 20H19'],
		languages: ['M4 6h8', 'M8 4v2', 'M6 6c0 4 2.5 6.5 5 7.5', 'M10 6c-.5 3.5-2.5 6-5.5 7.5', 'M13 20l3.5-8 3.5 8', 'M14.2 17.5h4.6'],
		globe: ['circle:12,12,8', 'M4 12h16', 'M12 4c2.2 2.3 3.2 5 3.2 8s-1 5.7-3.2 8c-2.2-2.3-3.2-5-3.2-8s1-5.7 3.2-8z'],
		chat: ['M5 5.5h14v10H11l-4 3.5v-3.5H5z'],
		mic: ['M9.5 6a2.5 2.5 0 015 0v5a2.5 2.5 0 01-5 0z', 'M6.5 11a5.5 5.5 0 0011 0', 'M12 16.5V20'],
		folder: ['M4 7a1 1 0 011-1h4l2 2h8a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1z'],
		grid2x2: ['M5 5h5.5v5.5H5z', 'M13.5 5H19v5.5h-5.5z', 'M5 13.5h5.5V19H5z', 'M13.5 13.5H19V19h-5.5z'],
		enso: ['M16.6 8.1A6 6 0 1 1 13.6 6.2']
	} as const;
	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name, size = 16, stroke = 1.5 }: { name: IconName; size?: number; stroke?: number } = $props();
	const parts = $derived(
		ICONS[name].map((d) => {
			if (!d.startsWith('circle:')) return { d };
			const [cx, cy, r] = d.slice(7).split(',');
			return { cx, cy, r };
		})
	);
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#each parts as p, i (i)}
		{#if 'd' in p}<path d={p.d} />{:else}<circle cx={p.cx} cy={p.cy} r={p.r} />{/if}
	{/each}
</svg>
