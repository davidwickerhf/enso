<script lang="ts">
	import DocPage from '$lib/components/DocPage.svelte';
	let { data } = $props();
	const idOf = (group: string) => `group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
</script>

<DocPage doc={data.doc} />

<div class="index">
	{#each data.nav as g (g.group)}
		{@const items = g.items.filter((i) => i.slug !== 'index')}
		{#if items.length}
			<section aria-labelledby={idOf(g.group)}>
				<h2 id={idOf(g.group)}>{g.group}</h2>
				<ul>
					{#each items as item (item.slug)}
						<li>
							<a href="/docs/{item.slug}">{item.title}</a>
							{#if item.description}<p>{item.description}</p>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
</div>

<style>
	.index {
		max-width: 52rem;
		margin-top: 2.5rem;
	}
	section + section {
		margin-top: 2.25rem;
	}
	h2 {
		font-size: 1.15rem;
		margin: 0 0 0.75rem;
		padding-bottom: 0.6rem;
		border-bottom: 1px solid var(--rule-strong);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 2.5rem;
	}
	li {
		padding: 0.85rem 0;
		border-bottom: 1px solid var(--rule);
	}
	li a {
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}
	li a:hover {
		color: var(--copper-text);
	}
	li p {
		margin: 0.25rem 0 0;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--ink-2);
	}
	@media (max-width: 860px) {
		ul {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
