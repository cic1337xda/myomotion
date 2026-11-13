import os
import resend

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "myomotion@mail.flowkraft.xyz")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def send_otp_email(recipient_email: str, otp_code: str, purpose: str = "register") -> bool:
    """
    Sends clinical authentication OTP email via Resend API.
    Uses dark-mode frosted glass medical aesthetic.
    """
    if not RESEND_API_KEY:
        print(f"[WARN] RESEND_API_KEY not configured. Simulating OTP: {otp_code} for {recipient_email}")
        return True

    action_title = "Account Verification" if purpose == "register" else "Password Reset Request"
    action_desc = (
        "Thank you for registering with MyoMotion. Please use the clinical authorization code below to verify your account."
        if purpose == "register"
        else "A request was received to reset the security password for your MyoMotion clinician/patient account. Enter the authorization code below to proceed."
    )

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body {{
          margin: 0;
          padding: 30px 15px;
          background-color: #090A0D;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #F9FAFB;
        }}
        .email-container {{
          max-width: 480px;
          margin: 0 auto;
          background: rgba(20, 22, 27, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 24px;
          padding: 36px 28px;
          text-align: center;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
        }}
        .brand-badge {{
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 16px;
          background: rgba(0, 122, 255, 0.15);
          border: 1px solid rgba(0, 122, 255, 0.35);
          margin-bottom: 20px;
        }}
        .brand-title {{
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #FFFFFF;
          margin-bottom: 4px;
        }}
        .brand-sub {{
          font-size: 11px;
          font-weight: 600;
          color: #007AFF;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 24px;
        }}
        .desc-text {{
          font-size: 14px;
          color: #9CA3AF;
          line-height: 1.6;
          margin-bottom: 28px;
        }}
        .otp-box {{
          background: rgba(0, 122, 255, 0.1);
          border: 1px solid rgba(0, 122, 255, 0.3);
          border-radius: 16px;
          padding: 18px 24px;
          display: inline-block;
          font-size: 38px;
          font-weight: 800;
          letter-spacing: 10px;
          color: #0A84FF;
          margin-bottom: 28px;
          font-family: monospace;
        }}
        .notice-text {{
          font-size: 12px;
          color: #6B7280;
          line-height: 1.5;
        }}
        .footer-text {{
          margin-top: 32px;
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 11px;
          color: #4B5563;
          letter-spacing: 0.04em;
        }}
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="brand-badge">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
          </svg>
        </div>
        <div class="brand-title">MyoMotion Medical</div>
        <div class="brand-sub">Upper-Limb Kinematics & sEMG Platform</div>

        <h2 style="font-size: 18px; font-weight: 700; margin: 0 0 12px 0;">{action_title}</h2>
        <p class="desc-text">{action_desc}</p>

        <div class="otp-box">{otp_code}</div>

        <p class="notice-text">
          This code is strictly confidential and valid for <strong>10 minutes</strong>.<br>
          If you did not request this verification, no action is required.
        </p>

        <div class="footer-text">
          &copy; 2026-2027 MyoMotion Clinical Systems &bull; flowkraft.xyz
        </div>
      </div>
    </body>
    </html>
    """

    try:
        resend.Emails.send({
            "from": f"MyoMotion Security <{RESEND_FROM_EMAIL}>",
            "to": recipient_email,
            "subject": f"MyoMotion Verification Code: {otp_code}",
            "html": html_content
        })
        print(f"[RESEND] OTP dispatched successfully to {recipient_email}")
        return True
    except Exception as e:
        print(f"[ERROR] Failed to send email via Resend: {e}")
        # In case domain is verifying or sandboxed, don't crash backend
        return False
