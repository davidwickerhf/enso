<script lang="ts">
	import { enhance } from '$app/forms';
	import { date } from '$lib/format';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Approve a device · Ensō</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap approve">
	<p class="label">Sync</p>
	{#if form?.decided === 'approved'}
		<h1>Approved</h1>
		<p class="lede">Go back to Ensō: it finishes signing in on its own within a few seconds. You can close this tab.</p>
	{:else if form?.decided === 'denied'}
		<h1>Denied</h1>
		<p class="lede">That device was not signed in. If you didn’t start this, nothing else is needed; your account is unchanged.</p>
	{:else if data.state === 'pending' && data.request}
		<h1>Sign in “{data.request.deviceName}”?</h1>
		<p class="lede">Ensō on this device asked to sync with your account. Approve only if you just started this yourself and the code below matches the one Ensō shows.</p>
		<p class="code" aria-label="Device code">{data.request.userCode}</p>
		<p class="muted meta">Requested {date(data.request.createdAt)}{data.request.ip ? ` from ${data.request.ip}` : ''}</p>
		<form method="POST" use:enhance>
			<input type="hidden" name="id" value={data.request.id} />
			<button class="btn" type="submit" name="decision" value="approve">Approve this device</button>
			<button class="btn ghost" type="submit" name="decision" value="deny">Deny</button>
		</form>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	{:else if data.state === 'expired'}
		<h1>This request expired</h1>
		<p class="lede">Requests are valid for 15 minutes. Start again from Ensō’s sync settings.</p>
	{:else if data.state === 'other-account'}
		<h1>Different account</h1>
		<p class="lede">This request was made for another email address. Sign out and open the link from that address’s inbox.</p>
	{:else if data.state === 'done' || data.state === 'denied'}
		<h1>Already answered</h1>
		<p class="lede">This request has already been {data.state === 'denied' ? 'denied' : 'approved'}. See your devices on the <a href="/account">account page</a>.</p>
	{:else}
		<h1>Request not found</h1>
		<p class="lede">The link may be incomplete. Start again from Ensō’s sync settings.</p>
	{/if}
</div>

<style>
	.approve {
		max-width: calc(40rem + 2 * var(--gutter));
		padding-top: clamp(2rem, 6vw, 4.5rem);
	}
	h1 {
		font-size: clamp(2rem, 5vw, 2.8rem);
		margin: 0.6rem 0 1rem;
		overflow-wrap: anywhere;
	}
	.lede {
		font-size: 1.2rem;
		color: var(--ink-2);
	}
	.code {
		display: inline-block;
		margin: 0.5rem 0;
		padding: 0.6rem 1.1rem;
		border: 1px solid var(--rule-strong);
		border-radius: 12px;
		background: var(--card);
		font-family: var(--mono);
		font-size: 1.7rem;
		letter-spacing: 0.14em;
	}
	.meta {
		font-family: var(--sans);
		font-size: 0.875rem;
	}
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
	.error {
		color: var(--danger);
		font-family: var(--sans);
	}
</style>
