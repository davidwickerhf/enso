/**
 * Docs and the privacy policy are Markdown files in content/, with a small
 * front matter block (title, description, order, group). Rendered once per
 * process with marked; the content is ours, so raw HTML is allowed.
 */
import { Marked } from 'marked';

export type Doc = { slug: string; title: string; description: string; order: number; group: string; html: string };

const files = import.meta.glob('/content/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const slugify = (s: string) =>
	s
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/&[a-z]+;/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');

function render(markdown: string) {
	const seen = new Map<string, number>();
	const marked = new Marked({
		gfm: true,
		renderer: {
			heading({ tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				if (depth === 1 || depth > 3) return `<h${depth}>${text}</h${depth}>\n`;
				let id = slugify(text);
				const n = seen.get(id) ?? 0;
				seen.set(id, n + 1);
				if (n) id = `${id}-${n}`;
				return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`;
			}
		}
	});
	return marked.parse(markdown, { async: false }) as string;
}

function parse(path: string, raw: string): Doc {
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
	const meta: Record<string, string> = {};
	if (m) {
		for (const line of m[1].split('\n')) {
			const i = line.indexOf(':');
			if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
		}
	}
	const body = m ? raw.slice(m[0].length) : raw;
	const slug = path.split('/').pop()!.replace(/\.md$/, '');
	return {
		slug,
		title: meta.title ?? slug,
		description: meta.description ?? '',
		order: Number(meta.order ?? 99),
		group: meta.group ?? 'Using Ensō',
		html: render(body)
	};
}

const all = Object.entries(files).map(([path, raw]) => ({ path, doc: parse(path, raw) }));

export const docs: Doc[] = all
	.filter((d) => d.path.startsWith('/content/docs/'))
	.map((d) => d.doc)
	.sort((a, b) => a.order - b.order);

export const GROUPS = ['Start', 'Using Ensō', 'Your data', 'Reference'];

export function getDoc(slug: string) {
	return docs.find((d) => d.slug === slug) ?? null;
}

export function getPage(name: string) {
	return all.find((d) => d.path === `/content/${name}.md`)?.doc ?? null;
}

export function docNav() {
	return GROUPS.map((group) => ({
		group,
		items: docs.filter((d) => d.group === group).map(({ slug, title, description }) => ({ slug, title, description }))
	})).filter((g) => g.items.length);
}

/** Pages that moved: old slug → new slug (the old address redirects). */
export const MOVED: Record<string, string> = {
	'claude-code': 'other-agents'
};
