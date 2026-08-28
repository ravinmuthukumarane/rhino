import transporter from '../config/email';
import { Alert } from '../types';
import { SectionSummary } from './plantSectionSummaryService';
import { formatISTDateTime } from '../utils/timeUtils';

const FROM = process.env.EMAIL_FROM ?? 'Energy Monitor <noreply@example.com>';
const UI = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const BRAND = '#1e40af';

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!process.env.SMTP_USER) { console.log(`[EMAIL SKIPPED] ${to} | ${subject}`); return; }
  await transporter.sendMail({ from: FROM, to, subject, html });
}

// Table-based layout with everything inlined (no <style> block, no external
// CSS) - the only markup that survives consistently across email clients
// (Outlook/Gmail strip <style> tags and class-based CSS). Every send*
// function below builds its own bodyHtml and wraps it in this.
function layout(title: string, bodyHtml: string, accent = BRAND): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;max-width:600px;width:100%;">
            <tr>
              <td style="background:${accent};padding:20px 28px;">
                <span style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.3px;">⚡ Energy Monitoring System</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:#1f2937;font-size:14px;line-height:1.6;">
                <h2 style="margin:0 0 14px;color:${accent};font-size:20px;">${title}</h2>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
                This is an automated message from the Energy Monitoring System — please do not reply to this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const button = (label: string, href: string, color = BRAND) =>
  `<a href="${href}" style="display:inline-block;padding:12px 24px;background:${color};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;margin:8px 0 4px;">${label}</a>`;

const row = (label: string, value: string | number) =>
  `<tr>
     <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${label}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:bold;">${value}</td>
   </tr>`;

const n = (v: number | null, dp = 2) => v != null ? Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';

async function sendVerification(email: string, name: string, token: string): Promise<void> {
  await send(email, 'Verify Your Email – Energy Monitor', layout('Verify your email', `
    <p>Hello ${name}, please verify your email to activate your account.</p>
    ${button('Verify Email', `${UI}/verify-email/${token}`)}
    <p style="color:#6b7280;font-size:13px;margin-top:16px;">This link expires in 24 hours.</p>`));
}

async function sendInvite(email: string, name: string, token: string): Promise<void> {
  await send(email, "You're Invited – Energy Monitor", layout("You're invited", `
    <p>Hello ${name}, an administrator has created an account for you on the Energy Monitoring System.</p>
    ${button('Set Your Password', `${UI}/reset-password/${token}`)}
    <p style="color:#6b7280;font-size:13px;margin-top:16px;">This link expires in 24 hours.</p>`));
}

async function sendPasswordReset(email: string, name: string, token: string): Promise<void> {
  await send(email, 'Password Reset – Energy Monitor', layout('Password reset', `
    <p>Hello ${name}, we received a request to reset your password.</p>
    ${button('Reset Password', `${UI}/reset-password/${token}`, '#dc2626')}
    <p style="color:#6b7280;font-size:13px;margin-top:16px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`, '#dc2626'));
}

async function sendAlert(alert: Alert, adminEmails: string[]): Promise<void> {
  if (!adminEmails.length) return;
  const color = { warning: '#f59e0b', critical: '#dc2626', info: '#3b82f6' }[alert.severity] ?? '#6b7280';
  const row = (label: string, value: string | number) =>
    `<tr>
       <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${label}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:bold;">${value}</td>
     </tr>`;
  await send(adminEmails.join(','), `[${alert.severity.toUpperCase()}] ${alert.alert_type.replace(/_/g,' ')} – Energy Monitor`, layout(`Alert: ${alert.alert_type.replace(/_/g,' ')}`, `
    <p style="display:inline-block;padding:2px 10px;border-radius:999px;background:${color}1a;color:${color};font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px;margin:0 0 12px;">${alert.severity}</p>
    <p>${alert.message}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;">
      ${row('Value', alert.value ?? 'N/A')}
      ${row('Setpoint', alert.setpoint_value ?? 'N/A')}
      ${row('Time', `${formatISTDateTime(new Date())} IST`)}
    </table>
    ${button('View Alerts', `${UI}/alerts`)}`, color));
}

async function sendScheduledReport(
  emails: string[], frequency: 'daily' | 'monthly', reportLabel: string, periodLabel: string,
  buffer: Buffer, filename: string, contentType: string,
  sections: SectionSummary[] = []
): Promise<void> {
  if (!emails.length) { console.log(`[EMAIL SKIPPED] ${frequency} report — no recipients`); return; }
  if (!process.env.SMTP_USER) { console.log(`[EMAIL SKIPPED] ${frequency} report — no SMTP`); return; }

  const sectionBlock = (s: SectionSummary) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 18px;">
      <tr><td colspan="2" style="padding:8px 12px;background:#eff6ff;font-weight:bold;color:${BRAND};font-size:13px;">${s.plant_section}</td></tr>
      ${row('Total kWh', n(s.total_kwh))}
      ${row('Max kVA', n(s.max_kva))}
      ${row('Avg Power Factor', n(s.avg_power_factor, 3))}
      ${row('Avg Voltage', n(s.avg_voltage, 1))}
      ${row('CEB kWh', n(s.ceb_kwh))}
      ${row('Generator kWh', n(s.generator_kwh))}
      ${row('Diesel (L)', n(s.total_liters))}
      ${row('Generator Run Hours', n(s.generator_run_hours))}
    </table>`;

  await transporter.sendMail({
    from: FROM, to: emails.join(','),
    subject: `${frequency === 'daily' ? 'Daily' : 'Monthly'} Report – ${reportLabel} – Energy Monitor`,
    html: layout(`${frequency === 'daily' ? 'Daily' : 'Monthly'} report – ${periodLabel}`, `
      <p>Summary for <b>${periodLabel}</b>, by plant section:</p>
      ${sections.length ? sections.map(sectionBlock).join('') : '<p style="color:#6b7280;">No section data available for this period.</p>'}
      <p>Full detail attached as <b>${reportLabel}</b>.</p>
      <p style="color:#6b7280;font-size:13px;">Attached as <span style="font-family:monospace;">${filename}</span></p>`),
    attachments: [{ filename, content: buffer, contentType }],
  });
}

export const emailService = { sendVerification, sendInvite, sendPasswordReset, sendAlert, sendScheduledReport };
