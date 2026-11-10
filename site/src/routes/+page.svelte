<script lang="ts">
	import CopyCommand from '$lib/components/CopyCommand.svelte';
	import NewTabDemo from '$lib/components/NewTabDemo.svelte';
	import Shot from '$lib/components/Shot.svelte';
	import GitHubMark from '$lib/components/GitHubMark.svelte';
	import { GITHUB_URL } from '$lib/links';
	import { screenshots } from '$lib/screenshots';

	let { data } = $props();

	const installCommand = 'curl -fsSL https://enso.wicker.life/install.sh | bash';
	const installCommandWindows = 'irm https://enso.wicker.life/install.ps1 | iex';
	const title = 'Ensō: search or ask from every new tab in Zen';
	const description =
		'Ensō turns the Zen browser’s new tab into one box for sites, searches and questions, and adds a sidebar that can read and act on the page you are on. It runs on your own Claude subscription and keeps everything on your computer.';
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:type" content="website" />
</svelte:head>

<section class="wrap hero" aria-labelledby="hero-title">
	<div class="intro">
		<h1 id="hero-title">Search or ask from every new&nbsp;tab.</h1>
		<div class="aside">
			<p>
				Ensō is a companion for the Zen browser. The new tab becomes one box for sites, searches and questions, and <kbd>⌘E</kbd> opens a sidebar
				that can read the page you’re on and work on it.
			</p>
			<div class="actions">
				<a class="btn" href={data.firefox.href}>Get it for Firefox</a>
				<a class="btn ghost" href="#install">How to install</a>
			</div>
			<p class="source">
				<a href={GITHUB_URL}><GitHubMark size={16} /> Open source on GitHub (MIT)</a>
			</p>
		</div>
	</div>
	<NewTabDemo />
</section>

<section class="wrap moment" aria-labelledby="page-title">
	<div class="split-text">
		<h2 id="page-title">Ask about the page you’re on, or hand it the work.</h2>
		<div>
			<p>
				Press <kbd>⌘E</kbd> and Ensō opens beside the page. It reads what you’re looking at, YouTube transcripts included, and you can bring in
				other tabs with <kbd>@</kbd>. Ask it to fill in a form and it types and clicks for you, outlining each field as it goes.
			</p>
			<p>
				<strong>What you ask for runs.</strong> Steps it comes up with on its own, and anything that sends, pays or can’t be undone, wait for
				your Allow. <a href="/docs/acting-on-pages">How acting on pages works</a>
			</p>
		</div>
	</div>
	<figure class="frame act">
		<Shot shot={screenshots.act} sizes="(min-width: 1312px) 1216px, 94vw" />
	</figure>
</section>

<section class="wrap moment" aria-labelledby="day-title">
	<div class="split-text">
		<h2 id="day-title">It knows your day, your tools and your spaces.</h2>
		<div>
			<p>
				Tell it once that you like short answers, or that Thursdays are for tutoring, and it remembers. What it knows about you is a profile
				you can read and change.
			</p>
			<p>
				It works through the claude.ai connectors you already use and any MCP server you add. Ask for a write-up and you get a report with
				charts, in its own tab.
			</p>
		</div>
	</div>
	<div class="trio">
		<figure>
			<div class="crop brief"><Shot shot={screenshots.brief} sizes="(min-width: 1024px) 34vw, 100vw" /></div>
			<figcaption><strong>Your day.</strong> Calendar, mail that needs you and what’s due, one click from every new tab.</figcaption>
		</figure>
		<figure>
			<div class="crop side"><Shot shot={screenshots.tools} sizes="(min-width: 1024px) 26vw, 100vw" /></div>
			<figcaption><strong>Your tools.</strong> Gmail, Calendar and Drive answer “what matters today?” in one go.</figcaption>
		</figure>
		<figure>
			<div class="crop side"><Shot shot={screenshots.spaces} sizes="(min-width: 1024px) 26vw, 100vw" /></div>
			<figcaption><strong>Your spaces.</strong> It knows which Zen space you’re in, and <kbd>@</kbd> reaches tabs in the others.</figcaption>
		</figure>
	</div>
</section>

<section class="wrap moment private" aria-labelledby="private-title">
	<div class="private-text">
		<h2 id="private-title">It runs on your computer, on your Claude plan.</h2>
		<p>
			Conversations, memory, reports and the activity log are files in a folder of yours. Ensō answers through Claude Code signed in with your
			own subscription, or an API key kept in your system’s keychain. What you send goes to Anthropic, never through a server of ours.
		</p>
		<p>
			Banking, payment, health, tax and government sites are never read or acted on. Sync between your computers is on its way, end-to-end
			encrypted, so our server will hold data it can’t read.
		</p>
		<p class="links"><a href="/privacy">Privacy policy</a> <a href="/docs/privacy-data">What is stored where</a></p>
	</div>
	<figure class="frame activity">
		<Shot shot={screenshots.activity} sizes="(min-width: 1024px) 56vw, 100vw" />
		<figcaption>Each click, typed field and chosen option is logged by site, next to what it remembers about you.</figcaption>
	</figure>
</section>

<section class="wrap install" id="install" aria-labelledby="install-title">
	<h2 id="install-title">Install it in three steps.</h2>
	<ol class="steps">
		<li>
			<h3>Add the extension</h3>
			<p>Two builds, the same Ensō. Zen asks you to confirm, and updates arrive on their own after that.</p>
			<div class="builds">
				<div class="build">
					<a class="btn" href={data.firefox.href}>Get it for Firefox</a>
					<p><strong>Firefox Add-ons, recommended.</strong> {data.firefox.listed ? 'Reviewed by Mozilla and updated from addons.mozilla.org.' : 'Until the listing on addons.mozilla.org is public, this is the direct download.'}</p>
				</div>
				<div class="build">
					<a class="btn ghost" href="/releases/enso-latest.xpi">Direct download</a>
					<p><strong>For developers.</strong> Includes page_eval, which lets agents run JavaScript in your pages to debug them. Updates from enso.wicker.life.</p>
				</div>
			</div>
			<p class="alt"><a href="/docs/install#two-builds">Which one should I choose?</a></p>
		</li>
		<li>
			<h3>Run one command</h3>
			<p>Press <kbd>⌘E</kbd> (<kbd>Ctrl</kbd>+<kbd>E</kbd> on Linux and Windows) and Ensō shows this with a Copy button: paste it in Terminal. It installs the helper Zen starts, with its own Node if you have none, and asks no questions.</p>
			<CopyCommand command={installCommand} />
			<p class="alt">On Windows, in PowerShell:</p>
			<CopyCommand command={installCommandWindows} />
		</li>
		<li>
			<h3>Finish in Setup</h3>
			<p>Claude, your agents, T3 Code and GitHub: a button each in Settings. Then open a new tab and ask.</p>
		</li>
	</ol>
	<p class="req">
		Needs macOS, Linux or Windows, Zen or Firefox 139 or newer, and your Claude plan (through Claude Code, which Setup installs) or an Anthropic API key. Questions count against
		your Claude plan’s usage, as they do in Claude Code. <a href="/docs/install">Full instructions</a>
	</p>
</section>

<style>
	.hero {
		padding-top: clamp(2rem, 6vw, 4.5rem);
	}
	.intro {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
		align-items: end;
		gap: clamp(1.5rem, 5vw, 4.5rem);
		margin-bottom: clamp(2rem, 4vw, 3rem);
	}
	h1 {
		font-size: clamp(2.4rem, 4.6vw, 3.9rem);
		line-height: 1.02;
		letter-spacing: -0.035em;
		font-weight: 600;
		max-width: 15ch;
	}
	.aside p {
		margin: 0 0 1.4rem;
		font-size: 1.125rem;
		line-height: 1.55;
		color: var(--ink-2);
		max-width: 34rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.aside p.source {
		margin: 1rem 0 0;
		font-size: 0.92rem;
		color: var(--ink-3);
	}
	.source a {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--ink-2);
	}
	.source a:hover {
		color: var(--ink);
	}

	.moment {
		padding-top: clamp(5rem, 11vw, 9rem);
	}
	.split-text {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(1.5rem, 5vw, 4.5rem);
		margin-bottom: clamp(2rem, 4vw, 3rem);
	}
	h2 {
		font-size: clamp(1.8rem, 3.2vw, 2.6rem);
		line-height: 1.08;
		letter-spacing: -0.03em;
		max-width: 16ch;
	}
	.split-text p,
	.private-text p {
		margin: 0 0 1rem;
		color: var(--ink-2);
		max-width: 36rem;
	}
	.split-text strong {
		color: var(--ink);
		font-weight: 600;
	}

	figure {
		margin: 0;
	}
	.frame {
		border-radius: 14px;
		overflow: hidden;
		background: var(--paper-2);
		border: 1px solid var(--rule);
		box-shadow: var(--shadow);
	}
	figcaption {
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--ink-3);
	}
	figcaption strong {
		color: var(--ink);
		font-weight: 600;
	}
	.frame figcaption {
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--rule);
		background: var(--card);
	}

	.trio {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(1rem, 2.4vw, 2rem);
		align-items: start;
	}
	.trio figcaption {
		margin-top: 0.85rem;
		max-width: 30ch;
	}
	.crop {
		position: relative;
		aspect-ratio: 4 / 5;
		border-radius: 14px;
		overflow: hidden;
		background: var(--paper-2);
		border: 1px solid var(--rule);
		box-shadow: var(--shadow);
	}
	.crop :global(img) {
		position: absolute;
		inset: 0;
		height: 100%;
	}
	.crop.side {
		aspect-ratio: 4 / 6.67;
	}
	.trio .brief {
		aspect-ratio: 5.4 / 6.67;
	}

	.private {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
		gap: clamp(2rem, 5vw, 4.5rem);
		align-items: center;
	}
	.private h2 {
		margin-bottom: 1.25rem;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		margin-top: 1.5rem !important;
	}

	.install {
		padding-top: clamp(5rem, 11vw, 9rem);
	}
	.install h2 {
		margin-bottom: clamp(1.75rem, 3vw, 2.5rem);
		max-width: none;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1fr);
		gap: clamp(1.5rem, 4vw, 3rem);
		counter-reset: step;
	}
	.steps li {
		counter-increment: step;
		min-width: 0;
		padding-top: 1rem;
		border-top: 2px solid var(--ink);
	}
	.steps h3 {
		font-size: 1.15rem;
		margin: 0 0 0.45rem;
	}
	.steps h3::before {
		content: counter(step) '  ';
		white-space: pre;
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}
	.steps p {
		margin: 0 0 1.1rem;
		color: var(--ink-2);
		font-size: 1rem;
	}
	.steps p.alt {
		margin: 0.7rem 0 0;
		font-size: 0.9rem;
	}
	.builds {
		display: grid;
		gap: 1rem;
	}
	.build p {
		margin: 0.45rem 0 0;
		font-size: 0.9rem;
		color: var(--ink-2);
	}
	.build p strong {
		color: var(--ink);
		font-weight: 600;
	}
	.req {
		margin: 2.5rem 0 0;
		padding-top: 1.25rem;
		border-top: 1px solid var(--rule);
		font-size: 0.92rem;
		color: var(--ink-3);
		max-width: 52rem;
	}

	@media (max-width: 1024px) {
		.trio {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.trio figure:first-child {
			grid-column: 1 / -1;
		}
		.trio .brief {
			aspect-ratio: 16 / 11;
		}
		.private {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 860px) {
		.intro,
		.split-text {
			grid-template-columns: minmax(0, 1fr);
			align-items: start;
		}
		.steps {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 560px) {
		.act.act :global(img.shot) {
			aspect-ratio: 4 / 5;
			object-position: 100% 0;
		}
		.activity.activity :global(img.shot) {
			aspect-ratio: 1 / 1;
			object-position: 0 0;
		}
		.trio {
			grid-template-columns: minmax(0, 1fr);
		}
		.crop.side {
			aspect-ratio: 4 / 5;
		}
		.trio .brief {
			aspect-ratio: 4 / 4.2;
		}
	}
</style>
