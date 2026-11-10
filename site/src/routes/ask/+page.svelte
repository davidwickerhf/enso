<script lang="ts">
	// Where Ensō's address-bar search engine points (extension manifest
	// search_provider: /ask#q={searchTerms}). With the extension installed, it
	// replaces this navigation before it loads, so nobody normally sees this page.
	// It shows when the extension isn't installed or the interception missed.
	// Privacy: the query is in the fragment, which browsers never send to the
	// server; it is read here in the browser only, then dropped from the address
	// bar. No analytics on this page (hooks.server.ts), and it isn't indexed.
	import { onMount } from 'svelte';
	import Enso from '$lib/components/Enso.svelte';

	let q = $state('');

	onMount(() => {
		const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
		q = (hash.get('q') ?? new URLSearchParams(location.search).get('q') ?? '').trim();
		if (location.hash || location.search) history.replaceState(history.state, '', location.pathname);
	});

	const enc = (s: string) => encodeURIComponent(s);
</script>

<svelte:head>
	<title>Address-bar search · Ensō</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="wrap ask">
	<Enso size={56} label="" />
	<h1>This link is for Ensō's address-bar search</h1>
	<p class="muted">
		Ensō is added to Zen as a search engine. With the Ensō extension installed, what you type in the address bar
		goes to Ensō's own page instead of here. Ensō doesn't seem to be installed in this browser, or it didn't
		catch this one.
	</p>

	{#if q}
		<div class="actions">
			<a class="btn" href="https://duckduckgo.com/?q={enc(q)}" rel="noreferrer">Search the web for “{q}”</a>
			<a class="btn ghost" href="https://www.google.com/search?q={enc(q)}" rel="noreferrer">Search Google</a>
		</div>
	{/if}

	<p class="small muted">
		Your search stays in your browser: it is part of the link after the <code>#</code>, which is never sent to
		this site, and nothing here records it. <a href="/docs/new-tab#the-address-bar" data-sveltekit-reload>How the address bar works with
		Ensō</a> · <a href="/docs/install" data-sveltekit-reload>Install Ensō</a>
	</p>
</div>

<style>
	.ask {
		max-width: calc(38rem + 2 * var(--gutter));
		padding-top: clamp(3rem, 10vw, 6rem);
		padding-bottom: 4rem;
		display: grid;
		gap: 0.9rem;
		justify-items: start;
	}
	h1 {
		font-size: clamp(1.7rem, 5vw, 2.3rem);
		line-height: 1.15;
		margin: 0.4rem 0 0;
	}
	p {
		margin: 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0.4rem 0;
		max-width: 100%;
	}
	.actions .btn {
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.small {
		font-size: 0.875rem;
	}
</style>
