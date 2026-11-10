<script lang="ts">
	import { page } from '$app/state';
	import Enso from './Enso.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	const links = [
		{ href: '/docs', label: 'Docs' },
		{ href: '/privacy', label: 'Privacy', wide: true },
		{ href: '/account', label: 'Account' }
	];
	const current = (href: string) => page.url.pathname.startsWith(href);
	const installHref = $derived(page.url.pathname === '/' ? '#install' : '/#install');
</script>

<header class="wrap bar">
	<a class="brand" href="/" aria-label="Ensō home">
		<Enso size={22} label="" />
		<span>Ensō</span>
	</a>
	<nav aria-label="Main">
		{#each links as l (l.href)}
			<a class:wide={l.wide} href={l.href} aria-current={current(l.href) ? 'page' : undefined}>{l.label}</a>
		{/each}
		<ThemeToggle />
		<a class="btn small install" href={installHref}>Install</a>
	</nav>
</header>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 1.1rem;
		padding-bottom: 1.1rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 1.15rem;
		font-weight: 600;
		letter-spacing: -0.01em;
		text-decoration: none;
	}
	nav {
		display: flex;
		align-items: center;
		gap: clamp(0.75rem, 2vw, 1.5rem);
		font-size: 0.95rem;
	}
	nav a:not(.btn) {
		text-decoration: none;
		color: var(--ink-2);
		padding: 0.4rem 0;
	}
	nav a:not(.btn):hover {
		color: var(--ink);
	}
	nav a[aria-current='page'] {
		color: var(--ink);
		font-weight: 600;
	}
	@media (max-width: 640px) {
		.wide {
			display: none;
		}
	}
	@media (max-width: 380px) {
		.install {
			display: none;
		}
	}
</style>
