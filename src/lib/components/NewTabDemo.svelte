<script lang="ts">
	// A faithful HTML recreation of Ensō's new-tab box (zen-config/chat/extension:
	// newtab.js, composer.js, omnibox.js, app.css), typing three things into it:
	// a site, a search and a question. Rows, labels, keys and buttons are what the
	// real box shows for that input; the sizes and colours come from app.css.
	import { onMount } from 'svelte';
	import AppIcon, { type IconName } from './AppIcon.svelte';

	type Row = { kind: 'site' | 'search' | 'suggest' | 'ask'; label: string; sub?: string; more?: string; hint?: string; active?: boolean };
	type Scenario = {
		id: string;
		name: string;
		says: string;
		typed: string;
		completion?: string;
		lead: IconName;
		button: { text: string; tone: 'go' | 'ask' };
		rows: (t: string) => Row[];
	};

	const scenarios: Scenario[] = [
		{
			id: 'site',
			name: 'A site',
			says: 'It finishes the address from your history. Enter opens it.',
			typed: 'goo',
			completion: 'google.com',
			lead: 'globe',
			button: { text: 'Go', tone: 'go' },
			rows: (t) => [
				{ kind: 'site', label: 'Google', sub: 'google.com', active: true },
				{ kind: 'search', label: t, sub: 'Google', hint: '⇧⌘↵' },
				{ kind: 'site', label: 'Google Maps', sub: 'google.com/maps' },
				{ kind: 'site', label: 'Goodreads', sub: 'goodreads.com' },
				{ kind: 'ask', label: t, sub: 'Chat', hint: '⌃⌘↵' }
			]
		},
		{
			id: 'search',
			name: 'A search',
			says: 'Plain words go to your search engine, with its suggestions underneath.',
			typed: 'cacio e pepe',
			lead: 'search',
			button: { text: 'Google', tone: 'go' },
			rows: (t) => [
				{ kind: 'search', label: t, sub: 'Google', hint: '⇧⌘↵', active: true },
				{ kind: 'ask', label: t, sub: 'Chat', hint: '⌃⌘↵' },
				{ kind: 'suggest', label: t, more: ' recipe' },
				{ kind: 'suggest', label: t, more: ' without cream' },
				{ kind: 'suggest', label: t, more: ' rome' }
			]
		},
		{
			id: 'ask',
			name: 'A question',
			says: 'A question goes to Ensō, which answers in the tab using your mail, calendar and files.',
			typed: 'what’s due this week?',
			lead: 'chat',
			button: { text: 'Ask', tone: 'ask' },
			rows: (t) => [
				{ kind: 'search', label: t, sub: 'Google', hint: '⇧⌘↵' },
				{ kind: 'ask', label: t, sub: 'Chat', hint: '⌃⌘↵', active: true }
			]
		}
	];

	const rowIcon: Record<Row['kind'], IconName> = { site: 'globe', search: 'search', suggest: 'search', ask: 'chat' };

	let index = $state(0);
	let typed = $state(scenarios[0].typed);
	let showCompletion = $state(true);
	let auto = $state(true);

	const sc = $derived(scenarios[index]);
	const rows = $derived(typed.length >= 1 ? sc.rows(typed) : []);
	const empty = $derived(typed.length === 0);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let reduce = false;
	let visible = true;

	const wait = (ms: number) => new Promise<void>((r) => (timer = setTimeout(r, ms)));

	let token = 0;
	let selecting = $state(false);

	async function play(i: number) {
		const run = ++token;
		showCompletion = false;
		const text = scenarios[i].typed;
		if (reduce) {
			index = i;
			typed = text;
			showCompletion = true;
			return;
		}
		// select all, then type over it, as you would in the real box
		selecting = true;
		await wait(380);
		if (run !== token) return;
		selecting = false;
		index = i;
		typed = text[0];
		for (const ch of text.slice(1)) {
			await wait(55 + Math.random() * 70);
			if (run !== token) return;
			typed += ch;
		}
		await wait(120);
		if (run !== token) return;
		showCompletion = true;
	}

	async function loop() {
		while (auto && !reduce) {
			await wait(3400);
			if (!auto) return;
			if (!visible || document.hidden) continue;
			await play((index + 1) % scenarios.length);
		}
	}

	function choose(i: number) {
		auto = false;
		clearTimeout(timer);
		play(i);
	}

	onMount(() => {
		reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const el = document.getElementById('nt-demo');
		const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.2 });
		if (el) io.observe(el);
		loop();
		return () => {
			auto = false;
			token++;
			clearTimeout(timer);
			io.disconnect();
		};
	});

	const completionTail = $derived(sc.completion && showCompletion && typed === sc.typed ? sc.completion.slice(typed.length) : '');
</script>

<div class="demo" id="nt-demo">
	<p class="sr-only">
		Animation of Ensō’s new-tab box. Typing “goo” completes to google.com and offers Go; typing “cacio e pepe” offers a Google search with
		suggestions; typing “what’s due this week?” selects Chat and offers Ask.
	</p>
	<div class="window" aria-hidden="true">
		<div class="zen">
			<div class="lights"><i></i><i></i><i></i></div>
			<ul class="tablist">
				<li class="on"><span class="fav enso"><AppIcon name="enso" size={13} stroke={3} /></span><span class="t">New Tab</span></li>
				<li><span class="fav" style="--c:#e62117">▶</span><span class="t">Lecture 9: TCP congestion control</span></li>
				<li><span class="fav" style="--c:#ea4335">M</span><span class="t">Inbox (12) · Gmail</span></li>
				<li><span class="fav" style="--c:#b5452d">C</span><span class="t">Resit registration</span></li>
				<li><span class="fav" style="--c:#4285f4">D</span><span class="t">Lab 3 brief · Google Docs</span></li>
			</ul>
			<div class="space"><AppIcon name="grid2x2" size={13} /> Space 1</div>
		</div>
		<div class="nt">
			<div class="top">
				<span class="pill"><span class="accent"><AppIcon name="grid2x2" size={14} /></span>Space 1</span>
				<span class="ib"><AppIcon name="history" size={17} /></span>
				<span class="ib"><AppIcon name="sliders" size={17} /></span>
			</div>
			<div class="center">
				<span class="mark"><AppIcon name="enso" size={48} stroke={3.6} /></span>
				<div class="box">
					<div class="row-in">
						<span class="lead"><AppIcon name={empty ? 'search' : sc.lead} size={18} /></span>
						<span class="input" class:placeholder={empty}>
							{#if empty}
								<span class="caret first"></span>Ask anything…
							{:else}
								{#if selecting}<span class="sel">{typed}{completionTail}</span>{:else}{typed}{#if completionTail}<span class="sel"
										>{completionTail}</span
									>{:else}<span class="caret"></span>{/if}{/if}
							{/if}
						</span>
					</div>
					{#if rows.length}
						<div class="omni">
							{#each rows as r, i (i)}
								<div class="orow" class:active={r.active} class:ask={r.kind === 'ask'}>
									<span class="oicon"><AppIcon name={rowIcon[r.kind]} size={17} stroke={r.kind === 'ask' ? 2.2 : 1.5} /></span>
									<span class="otext">
										{#if r.kind === 'suggest'}{r.label}<strong>{r.more}</strong>{:else}{r.label}<span class="osub">{` — ${r.sub}`}</span>{/if}
									</span>
									{#if r.hint}<span class="ohint">{r.hint}</span>{/if}
								</div>
							{/each}
						</div>
					{/if}
					<div class="foot">
						<span class="add"><AppIcon name="plus" size={15} />Add tabs or files</span>
						<span class="spacer"></span>
						<span class="ib mic"><AppIcon name="mic" size={16} /></span>
						{#if rows.length}
							<span class="send {sc.button.tone}">{sc.button.text} <span class="key">↵</span></span>
						{:else}
							<span class="send round"><AppIcon name="arrowUp" size={18} stroke={2} /></span>
						{/if}
					</div>
				</div>
				<div class="tools">
					<span class="tl">Your tools</span>
					<AppIcon name="mail" /><AppIcon name="calendar" /><AppIcon name="folder" /><AppIcon name="book" /><AppIcon name="languages" />
					<span class="tx"><AppIcon name="x" size={14} /></span>
				</div>
				<div class="brief">Good morning, Maya <span class="dot">·</span> <span class="link">Your day</span><AppIcon name="chevronRight" size={14} /></div>
			</div>
		</div>
	</div>

	<div class="intents" role="group" aria-label="What you can type">
		{#each scenarios as s, i (s.id)}
			<button type="button" aria-pressed={index === i} onclick={() => choose(i)}>
				<span class="iname">{s.name}</span>
				<span class="isays">{s.says}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.demo {
		--h: 560px;
	}
	.window {
		display: grid;
		grid-template-columns: 13.5rem minmax(0, 1fr);
		gap: 6px;
		padding: 6px;
		border-radius: 16px;
		background: var(--paper-2);
		border: 1px solid var(--rule);
		box-shadow: var(--shadow);
		font-family: var(--ui);
		color: var(--app-text);
		-webkit-user-select: none;
		user-select: none;
	}

	/* Zen's vertical tab strip, simplified */
	.zen {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px 4px 6px 6px;
		font-size: 12.5px;
		color: var(--ink-2);
		min-width: 0;
	}
	.lights {
		display: flex;
		gap: 7px;
		padding: 2px 4px 6px;
	}
	.lights i {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: var(--paper-3);
	}
	.tablist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.tablist li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 8px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tablist .t {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tablist li.on {
		background: var(--card);
		color: var(--ink);
		box-shadow: 0 1px 2px rgb(40 28 16 / 0.08);
	}
	.fav {
		flex: none;
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 4px;
		background: var(--c);
		color: #fff;
		font: 700 9px/1 var(--ui);
	}
	.fav.enso {
		background: none;
		color: var(--ink);
	}
	.space {
		margin-top: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		color: var(--ink-3);
	}

	/* the new tab itself (newtab mode of app.css) */
	.nt {
		position: relative;
		height: var(--h);
		border-radius: 11px;
		background: var(--nt-bg);
		overflow: hidden;
		box-shadow: 0 0 0 1px var(--app-line);
	}
	.top {
		position: absolute;
		top: 10px;
		right: 10px;
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 10px 0 8px;
		border-radius: 999px;
		background: var(--app-surface-2);
		font-size: 12.5px;
		font-weight: 500;
		color: var(--app-text);
	}
	.pill .accent {
		color: var(--app-accent);
		display: grid;
	}
	.ib {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		color: var(--app-text-2);
	}
	.center {
		width: min(680px, 100% - 48px);
		margin: 0 auto;
		padding-top: 76px;
		display: flex;
		flex-direction: column;
		align-items: stretch;
	}
	.mark {
		align-self: center;
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		margin-bottom: 22px;
		color: var(--app-text);
		opacity: 0.9;
	}
	.box {
		position: relative;
		z-index: 2;
		background: var(--app-surface);
		border: 1px solid color-mix(in srgb, var(--app-accent) 45%, var(--app-line-strong));
		border-radius: 18px;
		padding: 6px 8px 8px;
		box-shadow:
			0 1px 2px rgb(40 28 16 / 0.05),
			0 10px 30px -12px rgb(40 28 16 / 0.18);
	}
	.row-in {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.lead {
		display: grid;
		place-items: center;
		width: 28px;
		height: 36px;
		padding-left: 4px;
		color: var(--app-text-3);
		flex: none;
	}
	.input {
		flex: 1;
		min-width: 0;
		min-height: 40px;
		padding: 8px 6px;
		font-size: 16px;
		line-height: 24px;
		white-space: nowrap;
		overflow: hidden;
		color: var(--app-text);
	}
	.input.placeholder {
		color: var(--app-text-3);
	}
	.sel {
		background: var(--app-mark);
		border-radius: 2px;
	}
	.caret {
		display: inline-block;
		width: 1.5px;
		height: 19px;
		margin-left: 1px;
		vertical-align: -4px;
		background: var(--app-accent);
		animation: blink 1.05s steps(1) infinite;
	}
	.caret.first {
		margin: 0 1px 0 0;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	.omni {
		min-height: 195px;
		margin: 2px -2px 4px;
		padding-top: 4px;
		border-top: 1px solid var(--app-line);
	}
	.orow {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 38px;
		padding: 6px 12px;
		border-radius: 10px;
		font-size: 14px;
		min-width: 0;
	}
	.orow.active {
		background: var(--app-accent-soft);
	}
	.oicon {
		width: 20px;
		display: grid;
		place-items: center;
		flex: none;
		color: var(--app-text-2);
	}
	.orow.ask .oicon {
		color: var(--app-accent);
	}
	.otext {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.otext strong {
		font-weight: 600;
	}
	.osub {
		color: var(--app-text-3);
	}
	.ohint {
		flex: none;
		font-size: 12px;
		color: var(--app-text-3);
		letter-spacing: 0.04em;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 0 0 2px;
	}
	.spacer {
		flex: 1;
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px 0 9px;
		border-radius: 999px;
		border: 1px solid var(--app-line);
		color: var(--app-text-2);
		font-size: 13px;
	}
	.mic {
		color: var(--app-text-3);
	}
	.send {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 14px;
		border-radius: 999px;
		margin-left: 4px;
		font-weight: 600;
		font-size: 13.5px;
		transition: background-color 180ms var(--ease);
	}
	.send.go {
		background: var(--app-text);
		color: var(--app-surface);
	}
	.send.ask {
		background: var(--app-accent);
		color: #fff;
	}
	.send.round {
		width: 34px;
		padding: 0;
		justify-content: center;
		background: var(--app-accent);
		color: #fff;
		opacity: 0.45;
	}
	.key {
		opacity: 0.7;
		font-weight: 500;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: -14px 12px 0;
		padding: 22px 8px 8px 16px;
		border-radius: 0 0 16px 16px;
		background: color-mix(in srgb, var(--app-surface-2) 70%, transparent);
		font-size: 12.5px;
		color: var(--app-text-2);
	}
	.tl {
		flex: 1;
		color: var(--app-text-3);
	}
	.tx {
		display: grid;
		place-items: center;
		width: 22px;
		color: var(--app-text-3);
	}
	.brief {
		align-self: center;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 22px;
		font-size: 13px;
		color: var(--app-text-3);
	}
	.brief .link {
		color: var(--app-accent-text);
		font-weight: 500;
	}
	.brief :global(svg) {
		color: var(--app-accent-text);
		margin-left: -2px;
	}
	.brief .dot {
		opacity: 0.6;
	}

	/* the three intents under the window */
	.intents {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: clamp(1rem, 3vw, 2.5rem);
		margin-top: 1.25rem;
		padding-left: calc(13.5rem + 12px);
	}
	.intents button {
		display: grid;
		gap: 0.2rem;
		padding: 0.85rem 0 0;
		border: 0;
		border-top: 2px solid var(--rule);
		background: none;
		color: var(--ink-2);
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.45;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 200ms var(--ease),
			color 200ms var(--ease);
	}
	.intents button:hover {
		color: var(--ink);
		border-top-color: var(--rule-strong);
	}
	.intents button[aria-pressed='true'] {
		color: var(--ink);
		border-top-color: var(--ink);
	}
	.iname {
		font-weight: 600;
		color: var(--ink);
	}

	@media (max-width: 1024px) {
		.window {
			grid-template-columns: minmax(0, 1fr);
		}
		.zen {
			display: none;
		}
		.intents {
			padding-left: 0;
		}
	}
	@media (max-width: 640px) {
		.demo {
			--h: 460px;
		}
		.window {
			padding: 4px;
			border-radius: 14px;
		}
		.center {
			width: calc(100% - 20px);
			padding-top: 64px;
		}
		.mark {
			width: 44px;
			height: 44px;
			margin-bottom: 16px;
		}
		.mark :global(svg) {
			width: 40px;
			height: 40px;
		}
		.top .ib {
			display: none;
		}
		.orow {
			padding: 6px 8px;
			gap: 8px;
			font-size: 13.5px;
		}
		.orow:nth-child(n + 4) {
			display: none;
		}
		.omni {
			min-height: 119px;
		}
		.ohint {
			display: none;
		}
		.input {
			font-size: 15px;
		}
		.add {
			font-size: 0;
			gap: 0;
			padding: 0;
			width: 30px;
			justify-content: center;
		}
		.tools {
			margin: -14px 8px 0;
			gap: 8px;
		}
		.tools :global(svg:nth-of-type(n + 4)) {
			display: none;
		}
		.tx {
			display: none;
		}
		.intents {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.5rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.caret {
			animation: none;
		}
	}
</style>
