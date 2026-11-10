export function bytes(n: number) {
	if (n < 1024) return `${n} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let v = n;
	let i = -1;
	do {
		v /= 1024;
		i++;
	} while (v >= 1024 && i < units.length - 1);
	return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function date(iso: string | null) {
	if (!iso) return 'never';
	return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
