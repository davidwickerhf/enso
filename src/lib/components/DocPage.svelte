<script lang="ts">
	type Doc = { slug: string; title: string; description: string; html: string };
	let { doc }: { doc: Doc } = $props();
</script>

<svelte:head>
	<title>{doc.slug === 'index' ? 'Docs' : doc.title} · Ensō</title>
	{#if doc.description}<meta name="description" content={doc.description} />{/if}
</svelte:head>

<div class="prose">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own Markdown -->
	{@html doc.html}
</div>
