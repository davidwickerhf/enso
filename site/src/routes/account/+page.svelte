<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import CopyCommand from '$lib/components/CopyCommand.svelte';
	import SignIn from '$lib/components/SignIn.svelte';
	import { bytes, date } from '$lib/format';

	let { data, form } = $props();
	const pct = $derived(data.user ? Math.min(100, (data.storage!.usedBytes / data.storage!.quotaBytes) * 100) : 0);
	const next = $derived(page.url.searchParams.get('next') ?? '/account');
</script>

<svelte:head>
	<title>Account · Ensō</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap account">
	{#if !data.user}
		<section class="intro">
			<h1>Sign in to sync</h1>
			<p class="lede">
				You only need an account to sync Ensō between Macs. Everything is encrypted on your devices before it is uploaded; this page can show
				you how much is stored, but never what it is.
			</p>
			{#if data.deleted}
				<p class="notice" role="status">Your account and everything stored with it have been deleted.</p>
			{/if}
			{#if data.error}
				<p class="notice warn" role="alert">That sign-in link didn’t work. It may have expired or been used already; ask for a new one.</p>
			{/if}
			<div class="card">
				<SignIn {next} sent={form?.sent ?? null} error={form?.signinError ?? null} email={form?.email ?? ''} />
			</div>
			<p class="muted fine">Read how sync works in <a href="/docs/sync">Sync &amp; recovery</a> and what we keep in the <a href="/privacy">privacy policy</a>.</p>
		</section>
	{:else}
		<header class="top">
			<div>
				<h1>{data.user.email}</h1>
				<p class="muted">Member since {date(data.user.createdAt)}</p>
			</div>
			<form method="POST" action="?/signout" use:enhance>
				<button class="btn ghost small" type="submit">Sign out</button>
			</form>
		</header>

		<section aria-labelledby="storage">
			<h2 id="storage">Storage</h2>
			<div class="meter" role="meter" aria-valuemin="0" aria-valuemax={data.storage!.quotaBytes} aria-valuenow={data.storage!.usedBytes} aria-label="Storage used">
				<span style:width={`${Math.max(pct, data.storage!.usedBytes ? 0.8 : 0)}%`}></span>
			</div>
			<p class="muted">
				{bytes(data.storage!.usedBytes)} of {bytes(data.storage!.quotaBytes)} used · {data.storage!.blobCount}
				{data.storage!.blobCount === 1 ? 'encrypted item' : 'encrypted items'}
			</p>
		</section>

		<section aria-labelledby="devices">
			<h2 id="devices">Devices</h2>
			<p class="muted">Each Mac signed in to sync has its own key to this account. Removing one signs it out at once.</p>
			{#if data.devices!.length}
				<ul class="devices">
					{#each data.devices! as d (d.id)}
						<li>
							<div>
								<strong>{d.name}</strong>
								<span class="muted">Added {date(d.createdAt)} · last used {date(d.lastUsedAt)}</span>
							</div>
							<form method="POST" action="?/revoke" use:enhance>
								<input type="hidden" name="id" value={d.id} />
								<button class="btn ghost small" type="submit" aria-label={`Remove ${d.name}`}>Remove</button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">No devices yet. Sync isn’t available in Ensō yet; when it is, you’ll turn it on in Ensō’s settings and approve each Mac here.</p>
			{/if}
			{#if form?.deviceError}<p class="error" role="alert">{form.deviceError}</p>{/if}

			{#if form?.newToken}
				<div class="token" role="status">
					<p><strong>Token for “{form.newTokenDevice}”.</strong> Paste it into Ensō now; it is shown only this once.</p>
					<CopyCommand command={form.newToken} />
				</div>
			{/if}
			<details class="manual">
				<summary>Add a device by hand</summary>
				<p class="muted">For when the email approval isn’t convenient. You get a token to paste into Ensō’s sync settings.</p>
				<form method="POST" action="?/addDevice" use:enhance class="row">
					<label class="sr-only" for="device-name">Device name</label>
					<input id="device-name" name="name" type="text" maxlength="80" placeholder="e.g. Studio iMac" required />
					<button class="btn small" type="submit">Create token</button>
				</form>
			</details>
		</section>

		<section aria-labelledby="export">
			<h2 id="export">Export</h2>
			<p class="muted">Download everything this server holds for you as one JSON file: your devices, and every item still encrypted. Only your recovery phrase can open the items.</p>
			<a class="btn ghost small" href="/account/export" download>Download export</a>
		</section>

		<section class="danger-zone" aria-labelledby="delete">
			<h2 id="delete">Delete account</h2>
			<p class="muted">Deletes your account, signs out every device and removes every stored item from the server, right away. Ensō keeps working on your Macs with the data that is on them.</p>
			<form method="POST" action="?/delete" use:enhance>
				<label for="confirm">Type <strong>{data.user.email}</strong> to confirm</label>
				<div class="row">
					<input id="confirm" name="confirm" type="text" autocomplete="off" required aria-describedby={form?.deleteError ? 'delete-error' : undefined} />
					<button class="btn danger small" type="submit">Delete everything</button>
				</div>
				{#if form?.deleteError}<p class="error" id="delete-error" role="alert">{form.deleteError}</p>{/if}
			</form>
		</section>
	{/if}
</div>

<style>
	.account {
		max-width: calc(46rem + 2 * var(--gutter));
		padding-top: clamp(2rem, 6vw, 4.5rem);
	}
	h1 {
		font-size: clamp(2rem, 5vw, 3rem);
		margin: 0.6rem 0 0.75rem;
		overflow-wrap: anywhere;
	}
	section.intro {
		padding-top: 0;
		border-top: 0;
	}
	.lede {
		font-size: 1.2rem;
		color: var(--ink-2);
		margin: 0 0 2rem;
	}
	.card {
		padding: 1.5rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--card);
	}
	.fine {
		font-size: 0.95rem;
		margin-top: 1.5rem;
	}
	.notice {
		padding: 0.8rem 1rem;
		border-radius: 10px;
		background: var(--copper-wash);
		font-family: var(--sans);
		font-size: 0.95rem;
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding-bottom: 1.5rem;
	}
	.top p {
		margin: 0;
	}
	section {
		padding: 2rem 0;
		border-top: 1px solid var(--rule);
	}
	h2 {
		font-size: 1.5rem;
		margin-bottom: 0.6rem;
	}
	section > p {
		margin: 0 0 1rem;
	}
	.meter {
		height: 10px;
		border-radius: 999px;
		background: var(--paper-3);
		overflow: hidden;
		margin: 0.75rem 0;
	}
	.meter span {
		display: block;
		height: 100%;
		background: var(--copper);
		border-radius: 999px;
	}
	.devices {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
	}
	.devices li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.85rem 0;
		border-bottom: 1px solid var(--rule);
	}
	.devices li div {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.devices .muted {
		font-family: var(--sans);
		font-size: 0.85rem;
	}
	.empty {
		padding: 1rem 1.1rem;
		border: 1px dashed var(--rule-strong);
		border-radius: 10px;
		color: var(--ink-2);
	}
	.token {
		margin: 1rem 0;
		padding: 1rem;
		border: 1px solid var(--copper);
		border-radius: 12px;
		background: var(--copper-wash);
	}
	.token p {
		margin: 0 0 0.75rem;
	}
	.manual summary {
		cursor: pointer;
		font-family: var(--sans);
		font-size: 0.95rem;
		margin-top: 0.5rem;
	}
	.manual p {
		margin: 0.75rem 0;
	}
	.row {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}
	.row input {
		flex: 1;
		min-width: 0;
	}
	.danger-zone label {
		display: block;
		margin-bottom: 0.5rem;
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--danger);
		font-family: var(--sans);
		font-size: 0.9rem;
		margin: 0.5rem 0 0;
	}
	@media (max-width: 520px) {
		.row {
			flex-direction: column;
			align-items: stretch;
		}
		.top {
			flex-direction: column;
		}
	}
</style>
