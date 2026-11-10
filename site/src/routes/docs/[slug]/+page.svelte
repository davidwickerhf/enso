<script lang="ts">
	import DocPage from '$lib/components/DocPage.svelte';
	let { data } = $props();
	const order = $derived(data.nav.flatMap((g) => g.items));
	const at = $derived(order.findIndex((i) => i.slug === data.doc.slug));
</script>

<DocPage doc={data.doc} prev={at > 0 ? order[at - 1] : null} next={at >= 0 && at < order.length - 1 ? order[at + 1] : null} />
