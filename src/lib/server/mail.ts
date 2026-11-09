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
	const intro = device
		? `Ensō on "${device.name}" asked to sign in to your sync account. Check that this code matches the one shown in Ensō: ${device.code}`
		: 'Use this link to sign in to your Ensō account.';
	const text = `${intro}\n\n${url}\n\nThe link works once and expires in 15 minutes. If you didn't ask for it, ignore this email; nothing happens.\n\nEnsō · ${config.publicUrl}`;
	const html = `<!doctype html><html><body style="margin:0;background:#fcf8f1;font-family:Georgia,'Iowan Old Style',serif;color:#2a2420">
<div style="max-width:520px;margin:0 auto;padding:40px 24px">
<p style="font-size:22px;margin:0 0 24px">Ensō</p>
<p style="font-size:16px;line-height:1.6">${escape(intro)}</p>
${device ? `<p style="font-family:ui-monospace,Menlo,monospace;font-size:24px;letter-spacing:.12em;margin:16px 0">${escape(device.code)}</p>` : ''}
<p style="margin:28px 0"><a href="${escape(url)}" style="background:#2a2420;color:#fcf8f1;padding:12px 20px;border-radius:999px;text-decoration:none;font-family:-apple-system,system-ui,sans-serif;font-size:15px">Sign in</a></p>
<p style="font-size:14px;line-height:1.6;color:#6b5f55">The link works once and expires in 15 minutes. If you didn't ask for it, ignore this email; nothing happens.</p>
</div></body></html>`;
	return { to, subject: device ? `Sign in Ensō on ${device.name}` : 'Your Ensō sign-in link', text, html };
}
