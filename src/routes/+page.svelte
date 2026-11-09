<script lang="ts">
	import CopyCommand from '$lib/components/CopyCommand.svelte';
	import Enso from '$lib/components/Enso.svelte';
	import Shot from '$lib/components/Shot.svelte';
	import { screenshots } from '$lib/screenshots';

	const places = [
		{
			shot: screenshots.sidebar,
			title: 'In the sidebar',
			key: '⌘E',
			text: 'Open it next to any page. Ask about what you are reading, mention other tabs with @, attach a file or a screenshot.'
		},
		{
			shot: screenshots.newtab,
			title: 'On every new tab',
			key: '⌘T',
			text: 'Home opens with today: your calendar, mail that needs you, deadlines and follow-ups, refreshed through the day.'
		},
		{
			shot: screenshots.fullpage,
			title: 'As a full page',
			key: null,
			text: 'Room for longer work: all your conversations, reports, and the record of what Ensō did and where.'
		}
	];

	const features = [
		{
			title: 'It knows you',
			text: 'An editable profile and memory. Say once that you like short answers or that Tuesday is for deep work, and it remembers. You can read and change what it knows at any time.'
		},
		{
			title: 'It uses your tools',
			text: 'Gmail, Calendar, Drive and Docs through your claude.ai connectors, and any MCP server you add. Each one can be switched on or off.'
		},
		{
			title: 'It acts on pages',
			text: 'It reads the page, clicks, types, picks options, navigates and takes screenshots, outlining each element it touches, the way Claude in Chrome does.'
		},
		{
			title: 'The page is the context',
			text: 'Chat with the page you are on, YouTube transcripts included. Mention one tab or all of them, add files and screenshots. On sites like YouTube it offers the obvious next step, such as “Summarize this video”.'
		},
		{
			title: 'Skills',
			text: '/summarize, /factcheck, /translate, /reply, /brief and more. Write your own in plain words and it appears in the slash menu.'
		},
		{
			title: 'Tabs and history',
			text: 'Group, rename and close tabs by asking. Search your browsing history the way you would describe it to a person.'
		},
		{
			title: 'Reports',
			text: 'Ask for a write-up and get a document with charts that opens in its own tab, ready to read or print.'
		},
		{
			title: 'A record of everything',
			text: 'Every conversation is kept with each tool call and page action, and each site has its own activity log, so you can always check what was done.'
		}
	];

	const installCommand = 'curl -fsSL https://enso.wicker.life/install.sh | bash';
</script>

<svelte:head>
	<title>Ensō: the assistant that lives in your browser</title>
	<meta
		name="description"
		content="Ensō is a personal assistant for the Zen browser. It knows you, uses your tools and can act on web pages, on your own Claude subscription, with everything kept on your Mac."
	/>
	<meta property="og:title" content="Ensō: the assistant that lives in your browser" />
	<meta property="og:description" content="Knows you, uses your tools, acts on pages. Runs on your Claude subscription; your data stays on your Mac." />
	<meta property="og:type" content="website" />
</svelte:head>

<section class="wrap hero">
	<div class="copy">
		<p class="label">A companion for the Zen browser</p>
		<h1>The assistant that lives in your browser.</h1>
		<p class="promise">
			Ensō knows you, works with your mail, calendar and files, and can click and type on pages for you. It runs on your own Claude
			subscription, and what it knows stays on your Mac.
		</p>
		<div class="actions">
			<a class="btn" href="#install">Install Ensō</a>
			<a class="btn ghost" href="/docs">Read the docs</a>
		</div>
		<p class="meta">macOS · Zen or Firefox 139+ · Claude Code or an API key</p>
	</div>
	<div class="art" aria-hidden="true">
		<Enso size="100%" draw seal label="" />
	</div>
</section>

<section class="wrap hero-shot">
	<Shot shot={screenshots.hero} eager />
</section>

<section class="wrap section" aria-labelledby="places">
	<header class="head">
		<p class="label">Three places, one assistant</p>
		<h2 id="places">Wherever you are in the browser</h2>
		<p class="muted">The same conversations and memory in all three. Start something in the sidebar and pick it up on the full page.</p>
	</header>
	<ol class="places">
		{#each places as p (p.title)}
			<li>
				<Shot shot={p.shot} />
				<h3>
					{p.title}
					{#if p.key}<kbd>{p.key}</kbd>{/if}
				</h3>
				<p>{p.text}</p>
			</li>
		{/each}
	</ol>
</section>

<section class="wrap section split" id="features" aria-labelledby="features-title">
	<header class="head sticky">
		<p class="label">What it does</p>
		<h2 id="features-title">A personal assistant, with its hands on the page</h2>
		<p class="muted">Everything is built around one person: you. No team features, no feed, nothing to configure before it helps.</p>
		<a href="/docs">All features in the docs</a>
	</header>
	<ol class="features">
		{#each features as f, i (f.title)}
			<li>
				<span class="num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
				<h3>{f.title}</h3>
				<p>{f.text}</p>
			</li>
		{/each}
	</ol>
</section>

<section class="wrap section rule" aria-labelledby="rule">
	<div class="rule-grid">
		<div>
			<p class="label">The approval rule</p>
			<blockquote id="rule">
				<p>What you ask for runs. Steps it proposes on its own, and anything that can’t be undone, ask you first.</p>
			</blockquote>
			<p class="muted">
				Reading tools run straight away. Anything that sends, deletes, buys or changes something shows a card first: <strong>Allow</strong>,
				<strong>Always allow</strong> for that tool, or <strong>Deny</strong>. Banking and health sites are off limits altogether.
			</p>
			<a href="/docs/acting-on-pages">How acting on pages works</a>
		</div>
		<Shot shot={screenshots.approval} />
	</div>
</section>

<section class="wrap section" id="privacy" aria-labelledby="privacy-title">
	<header class="head">
		<p class="label">Privacy</p>
		<h2 id="privacy-title">Kept on your Mac</h2>
	</header>
	<div class="cols">
		<div>
			<h3>Local by default</h3>
			<p>
				Conversations, memory, your profile, reports and the activity log are files in your Library folder. There is no Ensō account unless
				you turn on sync.
			</p>
		</div>
		<div>
			<h3>Sensitive sites stay closed</h3>
			<p>
				Banking and health sites are never read or acted on. The page chip shows a lock, and nothing from that page is sent anywhere. You can
				add your own.
			</p>
		</div>
		<div>
			<h3>Sync you can’t be spied on through</h3>
			<p>
				Sync is optional and end-to-end encrypted. Your devices hold the key, and a 24-word phrase recovers it. Our server stores ciphertext
				it cannot read, under names it cannot read.
			</p>
		</div>
	</div>
	<p class="more"><a href="/privacy">Read the privacy policy</a> · <a href="/docs/privacy-data">What is stored where</a></p>
</section>

<section class="wrap section engine" aria-labelledby="engine-title">
	<header class="head">
		<p class="label">The engine</p>
		<h2 id="engine-title">Runs on your Claude subscription</h2>
		<p class="muted">
			Ensō has no model of its own and no server in the middle. It runs through Claude Code on your Mac, signed in with your Claude plan, using
			the Claude Agent SDK. Questions count against your plan’s usage limits, the same as using Claude Code.
		</p>
	</header>
	<div class="engines">
		<article>
			<p class="label">Default</p>
			<h3>Your Claude subscription</h3>
			<ul>
				<li>Needs Claude Code installed and signed in.</li>
				<li>Brings your claude.ai connectors and MCP sign-ins along.</li>
				<li>No separate bill: it uses the plan you already pay for.</li>
			</ul>
		</article>
		<article>
			<p class="label">Optional</p>
			<h3>An Anthropic API key</h3>
			<ul>
				<li>For pay-as-you-go use, without a plan.</li>
				<li>The key is kept in the macOS Keychain, never in a file.</li>
				<li>Anthropic bills you per token.</li>
			</ul>
		</article>
	</div>
	<p class="honest">
		Either way, what you send (your message and any page or file you include) goes to Anthropic to be answered, under your agreement with
		them. None of it passes through Ensō’s servers.
	</p>
</section>

<section class="wrap section install" id="install" aria-labelledby="install-title">
	<div class="install-card">
		<header>
			<p class="label">Install</p>
			<h2 id="install-title">Two steps, about a minute</h2>
		</header>
		<ol class="steps">
			<li>
				<h3>Install the helper</h3>
				<p class="muted">
					A small Node.js program that Zen starts when you open Ensō. The script checks your Mac, Node and Claude Code, and says what it is
					doing as it goes.
				</p>
				<CopyCommand command={installCommand} />
			</li>
			<li>
				<h3>Add the extension</h3>
				<p class="muted">Zen asks you to confirm. Updates arrive on their own after that.</p>
				<a class="btn" href="/releases/enso-latest.xpi">Download the extension</a>
			</li>
			<li>
				<h3>Press <kbd>⌘E</kbd></h3>
				<p class="muted">Ask about the page you are on, or open a new tab to see Home.</p>
			</li>
		</ol>
		<p class="req">
			Needs macOS (Linux later), Zen or Firefox 139 or newer, Node 18+, and Claude Code signed in or an Anthropic API key.
			<a href="/docs/install">Full instructions</a>
		</p>
	</div>
</section>

<style>
	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
		align-items: center;
		gap: clamp(2rem, 6vw, 6rem);
		padding-top: clamp(2.5rem, 8vw, 7rem);
		padding-bottom: clamp(2.5rem, 6vw, 5rem);
	}
	h1 {
		font-size: clamp(2.75rem, 6.6vw, 5.4rem);
		line-height: 1;
		letter-spacing: -0.028em;
		margin: 1.1rem 0 1.5rem;
	}
	.promise {
		font-size: clamp(1.2rem, 1.9vw, 1.42rem);
		line-height: 1.5;
		color: var(--ink-2);
		max-width: 34rem;
		margin: 0 0 2rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.meta {
		margin: 1.4rem 0 0;
		font-family: var(--sans);
		font-size: 0.85rem;
		color: var(--ink-3);
	}
	.art {
		justify-self: center;
		width: min(100%, 23rem);
	}

	.hero-shot {
		padding-bottom: clamp(3rem, 8vw, 6rem);
	}

	.section {
		padding-top: clamp(3.5rem, 9vw, 7.5rem);
	}
	.head {
		max-width: 38rem;
		margin-bottom: clamp(2rem, 4vw, 3.25rem);
	}
	.head h2 {
		font-size: clamp(2rem, 4vw, 3rem);
		margin: 0.7rem 0 1rem;
	}
	.head p.muted {
		margin: 0;
		font-size: 1.15rem;
	}

	.places {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: clamp(1.25rem, 3vw, 2.5rem);
	}
	.places h3 {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 1.45rem;
		margin: 1.4rem 0 0.5rem;
	}
	.places p {
		margin: 0;
		color: var(--ink-2);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.6fr);
		gap: clamp(2rem, 6vw, 6rem);
		align-items: start;
	}
	.sticky {
		position: sticky;
		top: 2rem;
	}
	.sticky a {
		display: inline-block;
		margin-top: 1.25rem;
		font-family: var(--sans);
		font-size: 0.95rem;
	}
	.features {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: clamp(1.5rem, 4vw, 3.5rem);
	}
	.features li {
		padding: 1.6rem 0 1.8rem;
		border-top: 1px solid var(--rule);
	}
	.num {
		font-family: var(--sans);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--copper-text);
		font-variant-numeric: lining-nums tabular-nums;
	}
	.features h3 {
		font-size: 1.4rem;
		margin: 0.5rem 0 0.5rem;
	}
	.features p {
		margin: 0;
		color: var(--ink-2);
		font-size: 1.05rem;
	}

	.rule-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(2rem, 6vw, 5rem);
		align-items: center;
		padding: clamp(2rem, 5vw, 4rem) 0;
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
	}
	blockquote {
		margin: 1rem 0 1.5rem;
		padding-left: 1.25rem;
		border-left: 3px solid var(--copper);
	}
	blockquote p {
		margin: 0;
		font-size: clamp(1.6rem, 3.1vw, 2.35rem);
		line-height: 1.22;
		font-style: italic;
		letter-spacing: -0.01em;
	}
	.rule-grid > div > p.muted {
		margin: 0 0 1.1rem;
	}
	.rule-grid a,
	.more a {
		font-family: var(--sans);
		font-size: 0.95rem;
	}

	.cols {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: clamp(1.5rem, 4vw, 3rem);
	}
	.cols > div {
		padding-top: 1.25rem;
		border-top: 2px solid var(--ink);
	}
	.cols h3 {
		font-size: 1.35rem;
		margin: 0 0 0.6rem;
	}
	.cols p {
		margin: 0;
		color: var(--ink-2);
	}
	.more {
		margin: 2rem 0 0;
		color: var(--ink-3);
	}

	.engines {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: clamp(1rem, 3vw, 2rem);
		max-width: 56rem;
	}
	.engines article {
		padding: 1.6rem 1.75rem 1.4rem;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--card);
	}
	.engines h3 {
		font-size: 1.4rem;
		margin: 0.45rem 0 0.75rem;
	}
	.engines ul {
		margin: 0;
		padding-left: 1.1rem;
		color: var(--ink-2);
		font-size: 1.02rem;
	}
	.engines li {
		margin: 0.3rem 0;
	}
	.engines li::marker {
		color: var(--copper);
	}
	.honest {
		max-width: 44rem;
		margin: 1.75rem 0 0;
		color: var(--ink-2);
		font-size: 1rem;
	}

	.install-card {
		padding: clamp(1.75rem, 5vw, 4rem);
		border-radius: calc(var(--radius) + 8px);
		background: var(--ink);
		color: var(--paper);
		--card: color-mix(in srgb, var(--paper) 7%, var(--ink));
		--rule-strong: color-mix(in srgb, var(--paper) 30%, transparent);
		--copper-text: var(--copper);
	}
	.install-card :global(.cmd) {
		color: var(--paper);
	}
	.install-card :global(.cmd button) {
		color: var(--paper);
	}
	.install-card h2 {
		font-size: clamp(2rem, 4vw, 3rem);
		margin: 0.7rem 0 2rem;
	}
	.install-card .muted {
		color: color-mix(in srgb, var(--paper) 72%, var(--ink));
	}
	.install-card .btn {
		background: var(--paper);
		color: var(--ink);
		border-color: var(--paper);
	}
	.install-card kbd {
		background: transparent;
		color: var(--paper);
		border-color: color-mix(in srgb, var(--paper) 40%, transparent);
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1.4fr 1fr 0.9fr;
		gap: clamp(1.5rem, 4vw, 3rem);
		counter-reset: step;
	}
	.steps li {
		counter-increment: step;
		min-width: 0;
	}
	.steps li::before {
		content: counter(step);
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		margin-bottom: 1rem;
		border: 1px solid var(--copper);
		border-radius: 50%;
		color: var(--copper);
		font-family: var(--sans);
		font-size: 0.85rem;
		font-variant-numeric: lining-nums;
	}
	.steps h3 {
		font-size: 1.35rem;
		margin: 0 0 0.5rem;
	}
	.steps p {
		margin: 0 0 1.1rem;
		font-size: 1rem;
	}
	.req {
		margin: 2.5rem 0 0;
		padding-top: 1.5rem;
		border-top: 1px solid color-mix(in srgb, var(--paper) 18%, transparent);
		font-family: var(--sans);
		font-size: 0.9rem;
		color: color-mix(in srgb, var(--paper) 72%, var(--ink));
	}
	.req a {
		color: var(--paper);
		margin-left: 0.35rem;
	}

	@media (max-width: 960px) {
		.split {
			grid-template-columns: 1fr;
		}
		.sticky {
			position: static;
		}
		.steps {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 760px) {
		.hero {
			grid-template-columns: 1fr;
		}
		.art {
			order: -1;
			justify-self: start;
			width: 7.5rem;
		}
		.art :global(.seal) {
			display: none;
		}
		.places,
		.features,
		.cols,
		.engines,
		.rule-grid {
			grid-template-columns: 1fr;
		}
		.places {
			gap: 2.5rem;
		}
	}
</style>
