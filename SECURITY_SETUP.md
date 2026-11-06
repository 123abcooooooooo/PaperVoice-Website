# PaperVoice: genuine private login (Cloudflare Access)

**Status: planned; not yet enabled.** Do not tell users PaperVoice is private until all public routes and deployment aliases have been tested without logging in.

Why not add a password field inside GitHub Pages? Because a static JavaScript check can be bypassed, and Pages hosting cannot restrict who fetches HTML/JS. Cloudflare Access authenticates **before the server responds**, protecting the actual site.

## Secure no-backend deployment

Continue using this GitHub repository for source, but deploy the contents of /docs to **Cloudflare Pages**.

### 1. Create Cloudflare account / deploy site

- Visit https://dash.cloudflare.com/ and choose the appropriate free account and Pages plan.
- Go to Workers & Pages → Create application → Pages → Connect to GitHub.
- Authorize the GitHub repository: `123abcooooooooo/PaperVoice-Website`.
- Production branch: `main`.
- Build command: `exit 0` (the files are prebuilt).
- Build output directory: `docs`.
- Deploy.

Important: **Do not share any public URL yet.** By default the new `*.pages.dev` address is public.

### 2. Configure Cloudflare Zero Trust / Access

- In https://dash.cloudflare.com/ open Zero Trust. Select Free plan. Cloudflare's onboarding documentation says payment details are requested even for the Free plan; check their terms before continuing, and do not select a paid plan.
- Set up the One-time PIN email login identity provider. New organizations use Cloudflare identity by default, so enable OTP explicitly if needed.
- Create an Access application for the **production** `<project>.pages.dev` address, with an Allow policy containing **individual approved email addresses** (not Everyone or an entire email domain). Set an appropriate session duration.
- Also protect **all preview deployments and deployment aliases**. Cloudflare Pages' "Enable access policy" protects previews only by default. See their official Known issues guide for how to protect the production `*.pages.dev` hostname AND the previews.

Reference: https://developers.cloudflare.com/pages/platform/known-issues/

### 3. Custom domain

- In the Cloudflare dashboard add the Namecheap domain `123abcooo.me`. Select Cloudflare's Free zone plan, review imported DNS entries, and at Namecheap change nameservers to the two Cloudflare nameservers shown.
- Under the Pages project **Custom domains**, add `papervoice.123abcooo.me`. Cloudflare Pages normally creates the DNS record automatically when the zone is managed on Cloudflare.
- **Only after the custom domain has successfully verified/issued HTTPS**, create a Cloudflare Zero Trust → Access → Applications → Self-hosted and private application covering `papervoice.123abcooo.me` with the **same** approved-email policy.
- Avoid setting up an Access policy on the custom domain *before* adding the custom domain: Cloudflare docs warn this can prevent the domain verification from completing.

### 4. Close bypasses and test

- Disable the previous **GitHub Pages** deployment in the repository Settings → Pages (if it was turned on). Otherwise someone could simply use the old `github.io` URL to bypass the Cloudflare login.
- Check from a private/incognito browser, not signed in:
  1. `https://papervoice.123abcooo.me/` must show Cloudflare's login before any site HTML or app.js.
  2. `https://<project>.pages.dev/` must also require login.
  3. Every live preview/branch/deployment URL must require login.
  4. An email not on your allowlist must be denied even after entering a PIN.
  5. Every approved email should be allowed through after code verification.
- Keep at least one approved administrator email in the policy, and require MFA for any Cloudflare/GitHub administrative logins.

## Operational / privacy notes

- Cloudflare Access Free has a defined user allowance. Confirm the current plan terms and **do not upgrade to pay-as-you-go** if you want no usage charges. The Cloudflare Zero Trust onboarding currently asks for billing details even on the Free plan.
- Free Cloudflare Access displays the standard hosted login. The custom HTML login-template option requires a paid plan.
- **The GitHub repository is public.** That means the application source remains visible even if the hosted site is protected. This is acceptable for the client-side PaperVoice decoder, which stores no recordings, but do not put passwords, personal audio, API keys, or user information into this repository.
- The browser QR decoder and MP3 converter still run locally after authorization.
- Never implement this by merely hiding a div with JavaScript or hard-coding a shared password into HTML.
- If you need to protect *source code* too, move the source to a private repository as a separate task and verify your deployment account can access it.

References:
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- https://developers.cloudflare.com/pages/platform/known-issues/
- https://developers.cloudflare.com/cloudflare-one/setup/
