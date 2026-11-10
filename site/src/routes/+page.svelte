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
	const mcpCommand = 'enso mcp install';
	const title = 'Ensō: search or ask from every new tab in Zen';
	const description =
		'Ensō turns the Zen browser’s new tab and address bar into one box for sites, searches and questions, adds a sidebar that reads and acts on the page you are on, and lets Claude Code, Codex, Cursor and OpenCode use your signed-in browser. It runs on your own Claude plan, on macOS, Linux and Windows, and keeps everything on your computer.';
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
				Ensō is a companion for the Zen browser. The new tab becomes one box for sites, searches and questions, <kbd>⌘E</kbd> opens a sidebar
				that can read the page you’re on and work on it, and the agents you already use can work in your browser as well.
			</p>
			<div class="actions">
				<a class="btn" href={data.firefox.href}>Get it for Firefox</a>
				<a class="btn ghost" href="#install">How to install</a>
			</div>
			<p class="source">
				<a href={GITHUB_URL}><GitHubMark size={16} /> Open source on GitHub (MIT)</a>
				<span>macOS, Linux and Windows</span>
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
				Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd> on Linux and Windows) and Ensō opens beside the page. It reads what you’re looking at, YouTube
				transcripts included. Bring in other tabs with <kbd>@</kbd>, attach files or a screenshot, and pick a skill with <kbd>/</kbd>. Ask it to
				fill in a form and it types and clicks for you, outlining each field as it goes.
			</p>
			<p>
				It answers with Claude, on your own subscription through Claude Code or on an Anthropic API key.
				<strong>What you ask for runs.</strong> Steps it comes up with on its own, and anything that sends, pays or can’t be undone, wait for
				your Allow. <a href="/docs/acting-on-pages">How acting on pages works</a>
			</p>
		</div>
	</div>
	<figure class="frame act">
		<Shot shot={screenshots.act} sizes="(min-width: 1312px) 1216px, 94vw" />
	</figure>
</section>

<section class="wrap moment" aria-labelledby="newtab-title">
	<div class="split-text">
		<h2 id="newtab-title">Every new tab is the box and the widgets you pick.</h2>
		<div>
			<p>
				Type a site, a search or a question. The button shows what <kbd>Enter</kbd> will do: open, search or ask. Opening and searching happen in
				the browser, so only questions go to Claude.
			</p>
			<p>
				Under the box, add the widgets you want: Next up, Due soon, Tasks from apps such as Commonfold, monday.com, GitHub reviews and failing
				checks across all your orgs, Mail, Clock, a note and quick links. Hover a task for its details. Tick off a task from an app Ensō signs in to, and it’s marked done there.
				<a href="/docs/widgets">All the widgets</a>
			</p>
		</div>
	</div>
	<figure class="frame widgets">
		<Shot shot={screenshots.widgets} sizes="(min-width: 1312px) 1216px, 94vw" />
	</figure>
</section>

<section class="wrap moment pair" aria-labelledby="urlbar-title">
	<div class="pair-text">
		<h2 id="urlbar-title">Or type in Zen’s address bar.</h2>
		<p>
			Ensō adds itself to Zen as a search engine. Make it your default and the address bar becomes Ensō’s box too: web addresses still open
			directly, and the rest comes to Ensō. Ensō never changes your default engine by itself.
		</p>
		<p>
			One setting decides where queries go: to Ensō, to your web search engine, or a choice each time. Start with <kbd>e</kbd> to ask or
			<kbd>g</kbd> to search, whatever the setting.
		</p>
		<p>
			With <code>zen.urlbar.replace-newtab</code> on, <kbd>⌘T</kbd> opens Zen’s floating command bar instead of a page: one box for addresses,
			searches and questions. <a href="/docs/new-tab#the-address-bar">Set up the address bar</a>
		</p>
	</div>
	<figure class="frame addressbar">
		<Shot shot={screenshots.addressBar} sizes="(min-width: 1024px) 50vw, 94vw" />
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
				It works through the claude.ai connectors you already use, the MCP servers you added to Claude Code, and servers Ensō signs in to
				itself, such as Commonfold and monday.com. GitHub is built in, across every org your account can see.
				<a href="/docs/tools">Connecting tools</a>
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
			<figcaption>
				<strong>Your spaces.</strong> Chats, memory and unsent drafts follow the Zen space you’re in, and <kbd>@</kbd> reaches tabs in the
				others.
			</figcaption>
		</figure>
	</div>
</section>

<section class="wrap moment" id="agents" aria-labelledby="agents-title">
	<div class="split-text">
		<h2 id="agents-title">Let your agents work in your browser.</h2>
		<div>
			<p>
				Claude Code, Codex, Cursor and OpenCode can use Zen through Ensō, where you’re already signed in: list and read your tabs, act on pages,
				read a page’s console and network log, search your history and use GitHub. Turn each one on in Settings, or run:
			</p>
			<CopyCommand command={mcpCommand} />
			<p class="after-cmd">
				No token ends up in their settings: they start the <code>enso</code> command, which connects to Zen on your computer.
				<a href="/docs/other-agents">Use Zen from other agents</a>
			</p>
		</div>
	</div>
	<figure class="frame agents">
		<Shot shot={screenshots.agents} sizes="(min-width: 1312px) 1216px, 94vw" />
		<figcaption>The pill on the page names the agent and its task. The card in Ensō’s sidebar shows its steps as they happen.</figcaption>
	</figure>
	<div class="agent-more">
		<ul class="points">
			<li>
				<h3>See it, and steer it</h3>
				<p>
					While an agent works, a pill at the top of the page names it and the tab’s title starts with ✦. From its card, <strong>Pause</strong>
					holds it, <strong>Stop</strong> ends the task, and <strong>Tell the agent…</strong> reaches it with its next step.
				</p>
			</li>
			<li>
				<h3>One agent per tab</h3>
				<p>
					The first agent to act on a tab holds it; another is told to open its own tab, unless you hand the tab over or let both act. When an
					agent needs your login on a site you haven’t allowed, the pill and the sidebar ask, with Allow and Not now.
				</p>
			</li>
			<li>
				<h3>Tools that fit real pages</h3>
				<p>
					Upload local files into a page, wait for an element, text, address or quiet network, query elements by CSS selector, and test in a
					separate headless Zen. Private sites are off-limits to agents as well.
				</p>
			</li>
		</ul>
		<figure>
			<div class="frame"><Shot shot={screenshots.settingsAgents} sizes="(min-width: 1024px) 44vw, 94vw" /></div>
			<figcaption>A switch per agent, and Full, Read or Off for all of them.</figcaption>
		</figure>
	</div>
</section>

<section class="wrap moment pair send" aria-labelledby="send-title">
	<div class="pair-text">
		<h2 id="send-title">Send a screenshot to the agent you’re working with.</h2>
		<p>
			Press <kbd>⌘⇧2</kbd> (<kbd>Ctrl+Shift+2</kbd> on Linux and Windows), drag over part of the page, and send it with a message to a T3 Code
			thread, to Claude Code, Codex, OpenCode or Cursor, or to the clipboard.
		</p>
		<p>
			Ensō picks the target when it can: the agent working on this tab, or the T3 project you linked to this site. The page’s address goes
			along, and its console errors if you tick them. <a href="/docs/screenshots">Send screenshots to your agents</a>
		</p>
	</div>
	<figure class="frame narrow">
		<Shot shot={screenshots.send} sizes="340px" />
	</figure>
</section>

<section class="wrap moment private" aria-labelledby="private-title">
	<div class="private-text">
		<h2 id="private-title">It runs on your computer, on your Claude plan.</h2>
		<p>
			A small helper on your computer keeps your conversations, memory, reports and activity log as files in a folder of yours. Ensō answers
			through Claude Code signed in with your own subscription, or an API key kept in your system’s keychain. What you send goes to Anthropic,
			never through a server of ours.
		</p>
		<p>
			Banking, payment, health, tax and government sites are never read, screenshotted or acted on, by Ensō or by your agents. A new install
			sends nothing on its own: the daily brief and search suggestions stay off until you turn them on.
		</p>
		<p>Sync between your computers is on its way, end-to-end encrypted, so our server will hold data it can’t read.</p>
		<p class="links"><a href="/privacy">Privacy policy</a> <a href="/docs/privacy-data">What is stored where</a></p>
	</div>
	<figure class="frame activity">
		<Shot shot={screenshots.activity} sizes="(min-width: 1024px) 56vw, 100vw" />
		<figcaption>Each click, typed field and chosen option is logged by site, next to what it remembers about you.</figcaption>
	</figure>
</section>

<section class="wrap install" id="install" aria-labelledby="install-title">
	<h2 id="install-title">Install it in two steps.</h2>
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
			<p>
				Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd> on Linux and Windows) and Ensō shows the command for your system with a Copy button. It installs
				the helper Zen starts, with its own Node if you have none, and asks no questions.
			</p>
			<p class="os">macOS and Linux, in a terminal:</p>
			<CopyCommand command={installCommand} />
			<p class="os">Windows, in PowerShell:</p>
			<CopyCommand command={installCommandWindows} />
			<p class="alt"><span class="new">New</span> Linux (x86_64, arm64) and Windows 10 and 11, since version 0.5.6.</p>
		</li>
	</ol>
	<p class="then">
		Then open <strong>Settings</strong>: Claude, your agents, T3 Code and GitHub are a button each. Open a new tab and ask.
	</p>
	<p class="req">
		Needs macOS, Linux or Windows, Zen or Firefox 142 or newer, and your Claude plan (through Claude Code, which Setup installs) or an Anthropic API key. Questions count against
		your Claude plan’s usage, as they do in Claude Code. <a href="/docs/install">Full instructions</a>
	</p>
</section>

<section class="wrap moment open" aria-labelledby="open-title">
	<h2 id="open-title">The code is open.</h2>
	<div>
		<p>
			The extension, the helper and the install scripts are MIT-licensed. Read how it works, report a problem or send a pull request on GitHub.
			The website and sync server are not part of that licence.
		</p>
		<a class="btn ghost" href={GITHUB_URL}><GitHubMark size={16} /> davidwickerhf/enso</a>
	</div>
</section>

<section class="wrap moment faq" aria-labelledby="faq-title">
	<h2 id="faq-title">Questions</h2>
	<div class="qs">
		<details>
			<summary>What does it cost?</summary>
			<p>
				There is no separate bill. Questions count against your Claude plan’s usage, as they do in Claude Code, or Anthropic bills your API key
				per token.
			</p>
		</details>
		<details>
			<summary>Does it work in Firefox?</summary>
			<p>Yes, in Firefox 142 or newer. Spaces are Zen’s, so in Firefox everything is in one place.</p>
		</details>
		<details>
			<summary>Which build should I install?</summary>
			<p>
				The Firefox Add-ons build, unless you want agents to run JavaScript in your pages with page_eval while you debug them. To switch, remove
				one and install the other; settings, conversations and memory are kept. <a href="/docs/install#two-builds">The two builds</a>
			</p>
		</details>
		<details>
			<summary>Does it sync between my computers?</summary>
			<p>Not yet. Sync is on its way, end-to-end encrypted, and will be off unless you turn it on.</p>
		</details>
	</div>
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
	.source span::before {
		content: '·';
		margin: 0 0.6rem;
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
	.private-text p,
	.pair-text p,
	.open p {
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

	.split-text :global(.cmd) {
		max-width: 36rem;
	}
	.split-text p.after-cmd {
		margin-top: 0.9rem;
		font-size: 0.95rem;
	}
	code {
		padding: 0.05em 0.3em;
		border-radius: 5px;
		background: var(--paper-2);
	}

	.pair {
		display: grid;
		grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
		gap: clamp(2rem, 5vw, 4.5rem);
		align-items: center;
	}
	.pair h2 {
		margin-bottom: 1.25rem;
	}
	.send {
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
	}
	.narrow {
		max-width: 340px;
		justify-self: center;
		width: 100%;
	}

	.agent-more {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(2rem, 5vw, 4.5rem);
		align-items: start;
		margin-top: clamp(2.5rem, 5vw, 4rem);
	}
	.agent-more figcaption {
		margin-top: 0.85rem;
	}
	.points {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1.6rem;
	}
	.points li {
		padding-top: 1rem;
		border-top: 1px solid var(--rule);
	}
	.points li:first-child {
		border-top: 2px solid var(--ink);
	}
	.points h3 {
		font-size: 1.15rem;
		margin: 0 0 0.4rem;
	}
	.points p {
		margin: 0;
		color: var(--ink-2);
		max-width: 36rem;
	}
	.points strong {
		color: var(--ink);
		font-weight: 600;
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
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
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
	.steps p.os {
		margin: 0.9rem 0 0.45rem;
		font-size: 0.9rem;
		color: var(--ink-3);
	}
	.new {
		display: inline-block;
		margin-right: 0.35rem;
		padding: 0.05em 0.5em;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--ink);
	}
	.then {
		margin: 2rem 0 0;
		color: var(--ink-2);
		max-width: 52rem;
	}
	.then strong {
		color: var(--ink);
		font-weight: 600;
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

	.open,
	.faq {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(1.5rem, 5vw, 4.5rem);
	}
	.open .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin-top: 0.4rem;
	}
	.qs {
		border-top: 2px solid var(--ink);
	}
	details {
		border-bottom: 1px solid var(--rule);
	}
	summary {
		cursor: pointer;
		padding: 1rem 0;
		font-weight: 600;
		list-style-position: outside;
	}
	summary:focus-visible {
		outline: 2px solid var(--copper);
		outline-offset: 2px;
	}
	details p {
		margin: 0 0 1.1rem;
		color: var(--ink-2);
		max-width: 36rem;
	}
	.faq {
		padding-bottom: clamp(2rem, 6vw, 4rem);
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
		.private,
		.pair,
		.send,
		.agent-more {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 860px) {
		.intro,
		.split-text,
		.open,
		.faq {
			grid-template-columns: minmax(0, 1fr);
			align-items: start;
		}
		.steps {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 560px) {
		.act.act :global(img.shot),
		.agents.agents :global(img.shot) {
			aspect-ratio: 4 / 5;
			object-position: 100% 0;
		}
		.widgets.widgets :global(img.shot) {
			aspect-ratio: 1 / 1;
			object-position: 0 100%;
		}
		.addressbar.addressbar :global(img.shot) {
			aspect-ratio: 5 / 4;
			object-position: 0 100%;
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
