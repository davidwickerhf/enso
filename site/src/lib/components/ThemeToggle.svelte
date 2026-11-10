<script lang="ts">
	import { onMount } from 'svelte';

	let theme = $state<'light' | 'dark'>('light');

	onMount(() => {
		const saved = document.documentElement.dataset.theme;
		theme = saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	});

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem('enso-theme', theme);
		} catch {
			/* private mode */
		}
	}
</script>

<button class="toggle" type="button" onclick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
	<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
		<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
		<path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
	</svg>
</button>

<style>
	.toggle {
		display: inline-grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid transparent;
		border-radius: 999px;
		background: transparent;
		color: var(--ink);
		cursor: pointer;
	}
	.toggle:hover {
		border-color: var(--rule-strong);
	}
</style>
