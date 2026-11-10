<script lang="ts">
	type Doc = { slug: string; title: string; description: string; html: string };
	type Link = { slug: string; title: string };
	let { doc, prev = null, next = null }: { doc: Doc; prev?: Link | null; next?: Link | null } = $props();
	const href = (slug: string) => (slug === 'index' ? '/docs' : `/docs/${slug}`);
</script>

<svelte:head>
	<title>{doc.slug === 'index' ? 'Docs' : doc.title} · Ensō</title>
	{#if doc.description}<meta name="description" content={doc.description} />{/if}
</svelte:head>

<div class="prose">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own Markdown -->
	{@html doc.html}
</div>

{#if prev || next}
	<nav class="pager" aria-label="Previous and next page">
		{#if prev}
			<a class="prev" href={href(prev.slug)} rel="prev"><span class="label">Previous</span>{prev.title}</a>
		{/if}
		{#if next}
			<a class="next" href={href(next.slug)} rel="next"><span class="label">Next</span>{next.title}</a>
		{/if}
	</nav>
{/if}

<style>
	.pager {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		max-width: var(--measure);
		margin-top: 3.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--rule);
		font-family: var(--sans);
	}
	.pager a {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.25rem 0;
		color: var(--ink);
		text-decoration: none;
		font-weight: 500;
	}
	.pager a:hover {
		color: var(--copper-text);
	}
	.next {
		grid-column: 2;
		text-align: right;
	}
</style>
