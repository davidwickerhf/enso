<script lang="ts">
	import type { Screenshot } from '$lib/screenshots';

	let { shot, sizes = '100vw', eager = false }: { shot: Screenshot; sizes?: string; eager?: boolean } = $props();

	const set = (one: string, two?: string) => (two ? `${one} ${shot.width}w, ${two} ${shot.width * 1.8}w` : undefined);
</script>

<!-- Both schemes are in the markup; CSS hides one, and a hidden lazy image is never fetched. -->
<img
	class="shot scheme-light"
	src={shot.light}
	srcset={set(shot.light, shot.light2x)}
	{sizes}
	width={shot.width}
	height={shot.height}
	alt={shot.alt}
	loading={eager ? 'eager' : 'lazy'}
	decoding="async"
/>
<img
	class="shot scheme-dark"
	src={shot.dark}
	srcset={set(shot.dark, shot.dark2x)}
	{sizes}
	width={shot.width}
	height={shot.height}
	alt={shot.alt}
	loading="lazy"
	decoding="async"
/>

<style>
	.shot {
		display: block;
		width: 100%;
		height: auto;
		object-fit: cover;
		object-position: top;
	}
</style>
