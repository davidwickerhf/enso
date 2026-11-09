// Applies the saved light/dark choice before first paint (no flash).
try {
	var t = localStorage.getItem('enso-theme');
	if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
