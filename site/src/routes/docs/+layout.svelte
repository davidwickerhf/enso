<script lang="ts">
	import { page } from '$app/state';
	import GitHubMark from '$lib/components/GitHubMark.svelte';
	import { GITHUB_URL } from '$lib/links';

	let { data, children } = $props();
	const active = $derived(page.params.slug ?? 'index');
	const current = $derived(data.nav.flatMap((g) => g.items).find((i) => i.slug === active));
</script>

<div class="wrap docs">
	<aside>
		<details class="mobile-nav">
			<summary><span class="label">Docs</span> {current?.title ?? 'Overview'}</summary>
			{@render nav()}
		</details>
		<div class="desk-nav">{@render nav()}</div>
	</aside>
	<article>
		{@render children()}
	</article>
</div>

{#snippet nav()}
	<nav aria-label="Documentation">
		<p class="source"><a href={GITHUB_URL}><GitHubMark size={15} /> Source on GitHub</a></p>
		{#each data.nav as g (g.group)}
			<p class="label">{g.group}</p>
			<ul>
				{#each g.items as item (item.slug)}
					<li>
						<a href={item.slug === 'index' ? '/docs' : `/docs/${item.slug}`} aria-current={item.slug === active ? 'page' : undefined}>
							{item.title}
						</a>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>
{/snippet}

<style>
	.docs {
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr);
		gap: clamp(2rem, 6vw, 5rem);
		padding-top: clamp(2rem, 5vw, 3.5rem);
	}
	article {
		min-width: 0;
	}
	aside {
		font-family: var(--sans);
		font-size: 0.92rem;
	}
	.desk-nav {
		position: sticky;
		top: 1.5rem;
	}
	nav .label {
		margin: 1.6rem 0 0.5rem;
	}
	nav .source + .label {
		margin-top: 0;
	}
	.source {
		margin: 0 0 1.6rem;
	}
	.source a {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--ink-2);
		text-decoration: none;
	}
	.source a:hover {
		color: var(--ink);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 1px solid var(--rule);
	}
	li a {
		display: block;
		padding: 0.32rem 0 0.32rem 0.9rem;
		margin-left: -1px;
		border-left: 2px solid transparent;
		color: var(--ink-2);
		text-decoration: none;
	}
	li a:hover {
		color: var(--ink);
	}
	li a[aria-current='page'] {
		color: var(--ink);
		border-left-color: var(--copper);
		font-weight: 500;
	}
	.mobile-nav {
		display: none;
	}
	@media (max-width: 860px) {
		.docs {
			grid-template-columns: minmax(0, 1fr);
			gap: 1.5rem;
		}
		.desk-nav {
			display: none;
		}
		.mobile-nav {
			display: block;
			border: 1px solid var(--rule-strong);
			border-radius: 12px;
			background: var(--card);
		}
		.mobile-nav summary {
			display: flex;
			gap: 0.75rem;
			align-items: baseline;
			padding: 0.8rem 1rem;
			cursor: pointer;
			list-style-position: inside;
		}
		.mobile-nav nav {
			padding: 0.25rem 1rem 1rem;
		}
	}
</style>
