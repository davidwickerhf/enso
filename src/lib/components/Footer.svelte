<script lang="ts">
	import Enso from './Enso.svelte';
</script>

<footer>
	<div class="wrap grid">
		<div class="sig">
			<Enso size={34} label="" />
			<p>Ensō is made by <a href="https://wicker.life">David Wicker</a>. An independent project, not affiliated with Anthropic, Mozilla or Zen.</p>
		</div>
		<nav aria-label="Footer">
			<div>
				<p class="label">Product</p>
				<a href="/#features">Features</a>
				<a href="/docs/install">Install</a>
				<a href="/docs/changelog">Changelog</a>
			</div>
			<div>
				<p class="label">Help</p>
				<a href="/docs">Docs</a>
				<a href="/docs/troubleshooting">Troubleshooting</a>
				<a href="mailto:hello@enso.wicker.life">hello@enso.wicker.life</a>
			</div>
			<div>
				<p class="label">Your data</p>
				<a href="/privacy">Privacy policy</a>
				<a href="/docs/sync">Sync &amp; recovery</a>
				<a href="/account">Account</a>
			</div>
		</nav>
	</div>
</footer>

<style>
	footer {
		margin-top: clamp(4rem, 10vw, 8rem);
		padding: 3rem 0 3.5rem;
		border-top: 1px solid var(--rule);
		font-family: var(--sans);
		font-size: 0.9rem;
		color: var(--ink-2);
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 2.5rem;
	}
	.sig {
		display: flex;
		gap: 1rem;
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
	nav div {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	nav .label {
		margin: 0 0 0.3rem;
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
		.grid,
		nav {
			grid-template-columns: 1fr 1fr;
		}
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
