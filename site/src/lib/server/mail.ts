import nodemailer from 'nodemailer';
import { config } from './config';

export type Mail = { to: string; subject: string; text: string; html: string };

/** Mails that were logged instead of sent (development and tests). Newest last. */
export const outbox: Mail[] = [];

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;

/**
 * Sends through Stalwart (SMTP_URL, e.g. smtps://noreply%40enso.wicker.life:…@mail.wicker.life:465).
 * Without SMTP_URL the mail is logged and kept in `outbox`; in production that
 * is refused unless MAIL_LOG_ONLY=true, so magic links never end up in logs by accident.
 */
export async function sendMail(mail: Mail) {
	if (!config.smtpUrl) {
		if (config.production && process.env.MAIL_LOG_ONLY !== 'true') {
			throw new Error('SMTP_URL is not set; refusing to log a sign-in link in production');
		}
		outbox.push(mail);
		if (outbox.length > 50) outbox.shift();
		if (process.env.MAIL_SILENT !== 'true') {
			console.info(`[mail] not sent (no SMTP_URL). To: ${mail.to}\nSubject: ${mail.subject}\n${mail.text}\n`);
		}
		return;
	}
	transport ??= nodemailer.createTransport(config.smtpUrl);
	await transport.sendMail({ from: config.emailFrom, ...mail });
}

const escape = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The sign-in email. `device` is set when a device asked to sign in. */
export function magicLinkMail(to: string, url: string, device?: { name: string; code: string }): Mail {
	const title = device ? `Sign in to Ensō on ${device.name}` : 'Sign in to Ensō';
	const intro = device
		? `Ensō on “${device.name}” asked to sign in to your sync account. Check that this code matches the one Ensō shows:`
		: 'Click the button below to sign in to your Ensō account.';
	const footnote = "The link works once and expires in 15 minutes. If you didn't ask for it, ignore this email; nothing happens.";
	const site = config.publicUrl.replace(/\/$/, '');
	const text = `${intro}${device ? ` ${device.code}` : ''}\n\n${url}\n\n${footnote}\n\nEnsō · ${site}`;

	const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f2ef;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(device ? `Code ${device.code} · expires in 15 minutes` : 'Your sign-in link · expires in 15 minutes')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f2ef">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
<tr><td style="padding:0 4px 20px">
<a href="${escape(site)}" style="text-decoration:none;color:#2a2420;font-family:${sans};font-size:15px;font-weight:600">
<img src="${escape(site)}/email/enso-mark.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;border-radius:7px;margin-right:8px">Ensō</a>
</td></tr>
<tr><td style="background:#fbfaf8;border:1px solid #e6e2dc;border-radius:14px;padding:32px 32px 28px;font-family:${sans};color:#2a2420">
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:650;letter-spacing:-.01em">${escape(title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a423b">${escape(intro)}</p>
${device ? `<p style="margin:-8px 0 24px;padding:14px 0;background:#f3f2ef;border-radius:10px;text-align:center;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:26px;letter-spacing:.18em;color:#2a2420">${escape(device.code)}</p>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:#d9643a;border-radius:10px"><a href="${escape(url)}" style="display:inline-block;padding:12px 22px;font-family:${sans};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">Sign in</a></td>
</tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7a6f66">${escape(footnote)}</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#9a9087">Button not working? Paste this into your browser:<br><a href="${escape(url)}" style="color:#ad4a26;word-break:break-all">${escape(url)}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${sans};font-size:12px;color:#9a9087">
Ensō · search or ask from every new tab in Zen · <a href="${escape(site)}" style="color:#9a9087">${escape(site.replace(/^https?:\/\//, ''))}</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
	return { to, subject: title, text, html };
}
