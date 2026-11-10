<script lang="ts">
	import { enhance } from '$app/forms';

	let {
		next = '/account',
		sent = null,
		error = null,
		email = ''
	}: { next?: string; sent?: string | null; error?: string | null; email?: string } = $props();
	let busy = $state(false);
</script>

{#if sent}
	<div class="sent" role="status">
		<h2>Check your inbox</h2>
		<p>We sent a sign-in link to <strong>{sent}</strong>. It works once and expires in 15 minutes.</p>
		<p class="muted small">Nothing there after a minute? Check spam, or <a href={`/account${next !== '/account' ? `?next=${encodeURIComponent(next)}` : ''}`}>try again</a>.</p>
	</div>
{:else}
	<form
		method="POST"
		action="/account?/signin"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update();
				busy = false;
			};
		}}
	>
		<input type="hidden" name="next" value={next} />
		<label for="email">Email address</label>
		<div class="row">
			<input id="email" name="email" type="email" autocomplete="email" required value={email} placeholder="you@example.com" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'signin-error' : undefined} />
			<button class="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a link'}</button>
		</div>
		{#if error}<p class="error" id="signin-error" role="alert">{error}</p>{/if}
		<p class="muted small">No password. New here? The link creates your account.</p>
	</form>
{/if}

<style>
	form {
		display: grid;
		gap: 0.5rem;
	}
	.row {
		display: flex;
		gap: 0.6rem;
	}
	.row input {
		flex: 1;
		min-width: 0;
	}
	.row .btn {
		flex: none;
	}
	.small {
		font-family: var(--sans);
		font-size: 0.875rem;
		margin: 0.25rem 0 0;
	}
	.error {
		margin: 0.25rem 0 0;
		color: var(--danger);
		font-family: var(--sans);
		font-size: 0.9rem;
	}
	.sent h2 {
		font-size: 1.6rem;
		margin-bottom: 0.5rem;
	}
	.sent p {
		margin: 0 0 0.5rem;
	}
	@media (max-width: 520px) {
		.row {
			flex-direction: column;
		}
	}
</style>
