<script lang="ts">
	import { page } from '$app/state';
	import Enso from './Enso.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	const links = [
		{ href: '/#features', label: 'Features', wide: true },
		{ href: '/docs', label: 'Docs' },
		{ href: '/privacy', label: 'Privacy', wide: true },
		{ href: '/account', label: 'Account' }
	];
	const current = (href: string) => href !== '/#features' && page.url.pathname.startsWith(href);
</script>

<header class="wrap bar">
	<a class="brand" href="/" aria-label="Ensō home">
		<Enso size={26} label="" />
		<span>Ensō</span>
	</a>
	<nav aria-label="Main">
		{#each links as l (l.href)}
			<a class:wide={l.wide} href={l.href} aria-current={current(l.href) ? 'page' : undefined}>{l.label}</a>
		{/each}
		<ThemeToggle />
		<a class="btn small install" href="/docs/install">Install</a>
	</nav>
</header>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 1.25rem;
		padding-bottom: 1.25rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1.35rem;
		text-decoration: none;
		letter-spacing: -0.01em;
	}
	nav {
		display: flex;
		align-items: center;
		gap: clamp(0.5rem, 2vw, 1.6rem);
		font-family: var(--sans);
		font-size: 0.925rem;
	}
	nav a:not(.btn) {
		text-decoration: none;
		color: var(--ink-2);
		padding: 0.4rem 0;
	}
	nav a:not(.btn):hover,
	nav a[aria-current='page'] {
		color: var(--ink);
		text-decoration: underline;
		text-decoration-color: var(--copper);
		text-underline-offset: 0.35em;
	}
	@media (max-width: 640px) {
		.wide {
			display: none;
		}
		.install {
			display: none;
		}
	}
</style>
