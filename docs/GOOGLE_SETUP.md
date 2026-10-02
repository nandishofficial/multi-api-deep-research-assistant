# Google Cloud setup (sign-in + Gmail send)

The app signs users in with Google and, by default, emails the report **from the user's own Gmail account to themselves** using the Gmail API. That needs one OAuth client with the `gmail.send` scope.

## 1. Create a project and enable the Gmail API

1. Open <https://console.cloud.google.com/> and create (or select) a project.
2. Go to **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.

## 2. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen** (called **Google Auth Platform → Branding / Audience / Data access** in the newer console).
2. User type: **External**. Fill in the app name, support email and developer contact.
3. **Scopes / Data access → Add or remove scopes**, and add:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/gmail.send` (listed as a *sensitive* scope)
4. **Audience / Test users**: while the app's publishing status is *Testing*, only listed test users can sign in. Add your own Gmail address and those of anyone reviewing the app.

> Because `gmail.send` is sensitive, test users see a "Google hasn't verified this app" interstitial. Click **Continue**. Publishing to everyone requires Google's verification review. For a demo, *Testing* mode with test users is enough.

## 3. Create the OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins**: `https://<your-app-domain>` (and `http://localhost:3000` for local development).
4. **Authorized redirect URIs**:
   - `https://<your-app-domain>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## 4. Check it

- Sign in. The consent screen should ask to "Send email on your behalf".
- If you signed in before the scope was added, sign out and sign in again. The app requests `prompt=consent` and `access_type=offline` so Google issues a refresh token, which the background worker uses to send the report when research finishes.
- If sending fails with "was not granted gmail.send", the research page shows the error and a **Retry email** button. Sign out, sign in again (granting the permission), then retry.

## Alternatives

To avoid the sensitive scope entirely, set `EMAIL_PROVIDER=resend` (with `RESEND_API_KEY` and `EMAIL_FROM`) or `EMAIL_PROVIDER=smtp` (with `SMTP_URL` and `EMAIL_FROM`). Sign-in then requests only the basic profile scopes, and reports are still delivered to the user's Gmail address.
