<script lang="ts">
	// The ensō brush circle from the app icon (zen-enso.svg), cropped to the stroke.
	let {
		size = 28,
		draw = false,
		seal = false,
		label = 'Ensō'
	}: { size?: number | string; draw?: boolean; seal?: boolean; label?: string } = $props();
</script>

<svg
	class="enso"
	class:draw
	viewBox="185 185 654 654"
	width={size}
	height={size}
	role="img"
	aria-label={label}
>
	<path
		d="M 707.3 348.1 A 255 255 0 1 1 578.0 265.7"
		fill="none"
		stroke="currentColor"
		stroke-width="112"
		stroke-linecap="round"
		pathLength="100"
	/>
	{#if seal}
		<g class="seal">
			<rect x="770" y="770" width="58" height="58" rx="8" fill="var(--copper)" />
			<rect x="779" y="779" width="40" height="40" rx="3" fill="none" stroke="var(--paper)" stroke-width="3.5" opacity=".8" />
		</g>
	{/if}
</svg>

<style>
	.enso {
		color: var(--ink);
		flex: none;
		overflow: visible;
	}
	.draw path {
		stroke-dasharray: 100;
		stroke-dashoffset: 100;
		animation: draw 1.6s cubic-bezier(0.65, 0, 0.35, 1) 0.15s forwards;
	}
	.draw .seal {
		opacity: 0;
		transform-origin: 799px 799px;
		animation: stamp 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) 1.65s forwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes stamp {
		from {
			opacity: 0;
			transform: scale(1.25) rotate(-6deg);
		}
		to {
			opacity: 1;
			transform: scale(1) rotate(-4deg);
		}
	}
	.seal {
		transform-origin: 799px 799px;
		transform: rotate(-4deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.draw path {
			stroke-dashoffset: 0;
			animation: none;
		}
		.draw .seal {
			opacity: 1;
			animation: none;
		}
	}
</style>
