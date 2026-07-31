// new-user-alert — pure logic extracted for testability (no Deno/IO/network).
// index.ts imports these; lib.test.ts tests them. Behavior unchanged.

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Infer sign-in provider from the user's email address.
export function providerFromEmail(email: string): string {
  if (email.includes("privaterelay.appleid.com")) {
    return "Apple";
  } else if (email.includes("gmail.com") || email.includes("googlemail.com")) {
    return "Google (likely)";
  } else {
    return "Google or Email";
  }
}

// Subject line for the admin alert email.
export function buildSubject(displayName: string, username: string): string {
  return `New WRotate user: ${displayName} (@${username})`;
}

// HTML body for the admin alert email. All dynamic values are expected
// pre-escaped by the caller, mirroring index.ts (displayName/username/email
// are esc()'d before being passed in).
export function buildEmailHtml(opts: {
  displayName: string;
  username: string;
  userEmail: string;
  provider: string;
  createdAt: string;
  count: number | null | undefined;
}): string {
  const { displayName, username, userEmail, provider, createdAt, count } = opts;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid #eee;">
          <img src="https://wrotate.com/icon.svg" alt="WRotate" width="40" height="40" style="display:inline-block;border-radius:9px;margin-bottom:8px;">
          <div style="font-size:18px;font-weight:700;color:#b8941f;letter-spacing:.03em;">New User Signup</div>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
            <tr><td style="padding:8px 0;font-weight:600;color:#888;width:110px;">Name</td><td style="padding:8px 0;">${displayName}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Username</td><td style="padding:8px 0;">@${username}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Email</td><td style="padding:8px 0;">${esc(userEmail)}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Provider</td><td style="padding:8px 0;">${provider}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Signed up</td><td style="padding:8px 0;">${createdAt}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#888;">Total users</td><td style="padding:8px 0;font-weight:600;color:#b8941f;">${count ?? "?"}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:4px 28px 28px;">
          <!-- /open, never the bare root: .well-known/apple-app-site-association
               EXCLUDES "/" and "/index.html", so a root link opens Safari instead
               of the installed iOS app. "/open" is the matched path. -->
          <a href="https://wrotate.com/open" style="display:inline-block;background:#b8941f;color:#fff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Open WRotate</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
