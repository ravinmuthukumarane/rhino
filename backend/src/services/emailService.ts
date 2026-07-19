import transporter from '../config/email';
import { Alert } from '../types';

const FROM = process.env.EMAIL_FROM ?? 'Energy Monitor <noreply@example.com>';
const UI = process.env.FRONTEND_URL ?? 'http://localhost:3000';

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!process.env.SMTP_USER) { console.log(`[EMAIL SKIPPED] ${to} | ${subject}`); return; }
  await transporter.sendMail({ from: FROM, to, subject, html });
}

async function sendVerification(email: string, name: string, token: string): Promise<void> {
  await send(email, 'Verify Your Email – Energy Monitor', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e40af">Energy Monitoring System</h2>
      <p>Hello ${name}, please verify your email:</p>
      <a href="${UI}/verify-email/${token}" style="display:inline-block;padding:12px 24px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0">Verify Email</a>
      <p style="color:#6b7280;font-size:13px">Expires in 24 hours.</p>
    </div>`);
}

async function sendPasswordReset(email: string, name: string, token: string): Promise<void> {
  await send(email, 'Password Reset – Energy Monitor', `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">Password Reset</h2>
      <p>Hello ${name},</p>
      <a href="${UI}/reset-password/${token}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;margin:16px 0">Reset Password</a>
      <p style="color:#6b7280;font-size:13px">Expires in 1 hour.</p>
    </div>`);
}

async function sendAlert(alert: Alert, adminEmails: string[]): Promise<void> {
  if (!adminEmails.length) return;
  const color = { warning: '#f59e0b', critical: '#dc2626', info: '#3b82f6' }[alert.severity] ?? '#6b7280';
  await send(adminEmails.join(','), `[${alert.severity.toUpperCase()}] ${alert.alert_type.replace(/_/g,' ')} – Energy Monitor`, `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${color}">Alert: ${alert.alert_type.replace(/_/g,' ')}</h2>
      <p>${alert.message}</p>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px;border:1px solid #e5e7eb"><b>Severity</b></td><td style="padding:6px;border:1px solid #e5e7eb;color:${color}">${alert.severity}</td></tr>
        <tr><td style="padding:6px;border:1px solid #e5e7eb"><b>Value</b></td><td style="padding:6px;border:1px solid #e5e7eb">${alert.value ?? 'N/A'}</td></tr>
        <tr><td style="padding:6px;border:1px solid #e5e7eb"><b>Setpoint</b></td><td style="padding:6px;border:1px solid #e5e7eb">${alert.setpoint_value ?? 'N/A'}</td></tr>
        <tr><td style="padding:6px;border:1px solid #e5e7eb"><b>Time</b></td><td style="padding:6px;border:1px solid #e5e7eb">${new Date().toLocaleString()}</td></tr>
      </table>
      <a href="${UI}/alerts" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px">View Alerts</a>
    </div>`);
}

async function sendMonthlyReport(emails: string[], reportName: string, buffer: Buffer): Promise<void> {
  if (!process.env.SMTP_USER) { console.log('[EMAIL SKIPPED] Monthly report — no SMTP'); return; }
  await transporter.sendMail({
    from: FROM, to: emails.join(','),
    subject: `Monthly Report – ${reportName} – Energy Monitor`,
    html: `<p>Please find the attached monthly energy & diesel consumption report for <b>${reportName}</b>.</p>`,
    attachments: [{ filename: `${reportName}.xlsx`, content: buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
  });
}

export const emailService = { sendVerification, sendPasswordReset, sendAlert, sendMonthlyReport };
