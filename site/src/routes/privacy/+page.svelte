<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Privacy policy · Ensō</title>
	<meta name="description" content={data.doc.description} />
</svelte:head>

<div class="wrap page">
	<div class="prose">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own Markdown -->
		{@html data.doc.html}
	</div>
</div>

<style>
	.page {
		padding-top: clamp(2rem, 5vw, 3.5rem);
	}
</style>
