<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Privacy policy · Ensō</title>
	<meta name="description" content={data.doc.description} />
</svelte:head>

<div class="wrap page">
	<div class="prose">
		<p class="label">Your data</p>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own Markdown -->
		{@html data.doc.html}
	</div>
</div>

<style>
	.page {
		padding-top: clamp(2rem, 5vw, 3.5rem);
	}
	.page .prose {
		margin: 0 auto;
	}
	.label {
		margin: 0 0 0.75rem;
	}
</style>
