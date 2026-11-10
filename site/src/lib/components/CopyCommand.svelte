<script lang="ts">
	let { command }: { command: string } = $props();
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(command);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			/* clipboard blocked: the text is selectable */
		}
	}
</script>

<div class="cmd">
	<code><span aria-hidden="true">$&nbsp;</span>{command}</code>
	<button type="button" onclick={copy} aria-label="Copy command">{copied ? 'Copied' : 'Copy'}</button>
	<span class="sr-only" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
</div>

<style>
	.cmd {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.5rem 0.5rem 1rem;
		border: 1px solid var(--rule-strong);
		border-radius: 12px;
		background: var(--card);
		max-width: 100%;
	}
	code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		font-size: 0.85rem;
		padding: 0.35rem 0;
		scrollbar-width: thin;
	}
	code span {
		color: var(--copper-text);
		user-select: none;
	}
	button {
		flex: none;
		min-height: 2.25rem;
		padding: 0.35rem 0.85rem;
		border: 1px solid var(--rule-strong);
		border-radius: 8px;
		background: transparent;
		color: var(--ink);
		font-family: var(--sans);
		font-size: 0.8rem;
		cursor: pointer;
	}
	button:hover {
		border-color: var(--ink);
	}
</style>
