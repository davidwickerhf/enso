<script lang="ts">
	import Enso from './Enso.svelte';
</script>

<footer>
	<div class="wrap grid">
		<div class="sig">
			<Enso size={28} label="" />
			<p>
				Made by <a href="https://wicker.life">David Wicker</a>. An independent project, not affiliated with Anthropic, Mozilla or Zen.
			</p>
		</div>
		<nav aria-label="Footer">
			<ul>
				<li><a href="/#install">Install</a></li>
				<li><a href="/docs">Docs</a></li>
				<li><a href="/docs/changelog">Changelog</a></li>
				<li><a href="/docs/troubleshooting">Troubleshooting</a></li>
			</ul>
			<ul>
				<li><a href="/privacy">Privacy policy</a></li>
				<li><a href="/docs/privacy-data">What is stored where</a></li>
				<li><a href="/docs/sync">Sync &amp; recovery</a></li>
				<li><a href="/account">Account</a></li>
			</ul>
			<ul>
				<li><a href="mailto:hello@enso.wicker.life">hello@enso.wicker.life</a></li>
			</ul>
		</nav>
	</div>
</footer>

<style>
	footer {
		margin-top: clamp(5rem, 11vw, 9rem);
		padding: 2.5rem 0 3rem;
		border-top: 1px solid var(--rule);
		font-size: 0.9rem;
		color: var(--ink-2);
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
		gap: 2.5rem;
	}
	.sig {
		display: flex;
		gap: 0.9rem;
		align-items: flex-start;
		max-width: 22rem;
	}
	.sig p {
		margin: 0;
		line-height: 1.55;
	}
	nav {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1.5rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.45rem;
		align-content: start;
	}
	nav a {
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	nav a:hover {
		color: var(--ink);
		text-decoration: underline;
		text-decoration-color: var(--copper);
	}
	@media (max-width: 760px) {
		.grid {
			grid-template-columns: 1fr;
		}
		nav {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
