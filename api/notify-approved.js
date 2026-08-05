export const config = { maxDuration: 10 };

// STUB: when an admin flips a pending user to approved, the client (or a
// Supabase trigger) hits this endpoint so we can send the user an email.
// No email service is wired yet — this just logs and returns 200 so the
// caller succeeds. Replace the console.log with the real send when SES /
// Resend / SendGrid creds land in env.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { name, email, role } = req.body || {};
  if (!email) return res.status(400).json({ error: "Missing email" });

  console.log("[notify-approved] approved user:", { name, email, role, at: new Date().toISOString() });

  // TODO: send "Your Prospector access is approved" email via SES/Resend.

  return res.status(200).json({ ok: true, stub: true });
}
