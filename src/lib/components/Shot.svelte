<script lang="ts">
	import type { Screenshot } from '$lib/screenshots';
	import Enso from './Enso.svelte';

	let { shot, eager = false }: { shot: Screenshot; eager?: boolean } = $props();
</script>

<figure class="shot" style:aspect-ratio={shot.ratio}>
	{#if shot.src}
		<img src={shot.src} alt={shot.alt} loading={eager ? 'eager' : 'lazy'} decoding="async" />
	{:else}
		<div class="placeholder" role="img" aria-label={`Screenshot to come: ${shot.alt}`}>
			<div class="chrome" aria-hidden="true">
				<span></span><span></span><span></span>
				<i></i>
			</div>
			<div class="mark" aria-hidden="true"><Enso size="22%" label="" /></div>
			<p class="caption">
				<span class="label">Screenshot</span>
				<span class="cap">{shot.caption}</span>
			</p>
		</div>
	{/if}
</figure>

<style>
	.shot {
		position: relative;
		margin: 0;
		width: 100%;
		border-radius: var(--radius);
		overflow: hidden;
		background: var(--card);
		border: 1px solid var(--rule);
		box-shadow: var(--shadow);
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.placeholder {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background:
			repeating-linear-gradient(135deg, transparent 0 14px, var(--copper-wash) 14px 15px),
			linear-gradient(180deg, var(--card), var(--paper-2));
	}
	.chrome {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border-bottom: 1px solid var(--rule);
		background: var(--paper-2);
	}
	.chrome span {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 1px solid var(--rule-strong);
	}
	.chrome i {
		flex: 1;
		max-width: 50%;
		height: 12px;
		margin-left: 12px;
		border-radius: 6px;
		background: var(--rule);
	}
	.mark {
		width: 100%;
		display: grid;
		place-items: center;
		opacity: 0.16;
	}
	.caption {
		margin: 0;
		position: absolute;
		left: 16px;
		bottom: 14px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-family: var(--sans);
	}
	.cap {
		font-size: 0.875rem;
		color: var(--ink-2);
	}
</style>
