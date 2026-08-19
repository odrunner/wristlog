# click.wrotate.com — SES click tracking + Universal Links

CloudFront in front of `r.us-west-2.awstrack.me` so SES can rewrite email links to
`https://click.wrotate.com/…` over HTTPS, plus an Apple App Site Association file on
that host so iOS opens the WRotate app from a tracked link instead of Safari.

Why this exists: iOS matches Universal Links on the INITIAL URL's host and never
re-evaluates after the redirect lands on wrotate.com. Click tracking is therefore OFF
in SES until this host serves the AASA and an app build with
`applinks:click.wrotate.com` (2.4+, shipped 2026-08-02) is the norm.

## Layout
- `bin/click-tracking.ts` — app entry; stack in us-east-1 (CloudFront needs us-east-1 certs)
- `lib/click-tracking-stack.ts` — Distribution, origin-request policy (forwards `Host`), private S3 bucket for `/.well-known/*`
- `assets/.well-known/apple-app-site-association` — deployed to the bucket as `application/json`

## One-time runbook
1. **Request the certificate** (once, out-of-band — a DNS-validated cert in-stack would block the deploy for as long as the CNAME is missing):
   ```bash
   aws acm request-certificate --region us-east-1 \
     --domain-name click.wrotate.com --validation-method DNS \
     --query CertificateArn --output text
   aws acm describe-certificate --region us-east-1 --certificate-arn <ARN> \
     --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
   ```
   Add the returned CNAME in **Cloudflare DNS, proxy OFF (grey cloud)**. Wait for `Status: ISSUED`.
2. **Bootstrap + deploy** (first time only needs bootstrap):
   ```bash
   cd infra/click-tracking && npm install
   npx cdk bootstrap aws://392424878015/us-east-1
   npx cdk deploy -c certificateArn=<ARN>
   ```
3. **DNS**: `click.wrotate.com CNAME <DistributionDomainName output>` — Cloudflare, **proxy OFF**
   (grey cloud). Proxied would put Cloudflare's cert + CDN in front of CloudFront; not needed.
4. **Verify**
   ```bash
   curl -sI https://click.wrotate.com/favicon.ico | grep -i 'x-amz-ses'   # expect region us-west-2, protocol https
   curl -s https://click.wrotate.com/.well-known/apple-app-site-association
   ```
5. **SES** — only after 2.6 is live and `device_tokens.app_version` is populated (see
   CLAUDE.md "Click tracking is OFF"): set `TrackingOptions.CustomRedirectDomain=click.wrotate.com`,
   `HttpsPolicy=REQUIRE` on a *second* config set used for app-version-gated recipients, and
   enable the CLICK event type on its event destination.

## Changing the AASA
Edit `assets/.well-known/apple-app-site-association` and `cdk deploy` again. The bucket
deployment prunes + re-uploads; CloudFront caches it for up to 1h (`CachePolicy.CACHING_OPTIMIZED`
respects the object's `Cache-Control: max-age=3600`). Apple's CDN re-fetches on app
install/update and periodically.
