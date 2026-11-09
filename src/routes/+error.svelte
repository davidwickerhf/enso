<script lang="ts">
	import { page } from '$app/state';
	import Enso from '$lib/components/Enso.svelte';
</script>

<svelte:head><title>{page.status} · Ensō</title></svelte:head>

<div class="wrap err">
	<Enso size={72} label="" />
	<p class="label">{page.status}</p>
	<h1>{page.status === 404 ? 'Nothing here' : 'Something went wrong'}</h1>
	<p class="muted">{page.error?.message ?? ''}</p>
	<p><a href="/">Home</a> · <a href="/docs">Docs</a></p>
</div>

<style>
	.err {
		max-width: calc(36rem + 2 * var(--gutter));
		padding-top: clamp(3rem, 10vw, 7rem);
		display: grid;
		gap: 0.4rem;
	}
	h1 {
		font-size: 2.6rem;
	}
	.label {
		margin-top: 1.5rem;
	}
</style>
