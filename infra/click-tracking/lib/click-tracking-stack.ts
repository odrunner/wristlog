import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as path from "node:path";

export interface ClickTrackingStackProps extends cdk.StackProps {
  /** Hostname recipients see in tracked links, e.g. click.wrotate.com */
  readonly domainName: string;
  /** SES tracking endpoint for the SENDING region (must match the config set's region). */
  readonly sesTrackingOrigin: string;
  /** ACM certificate (us-east-1) covering domainName. Requested out-of-band — see README. */
  readonly certificateArn: string;
}

/**
 * click.wrotate.com — SES custom click/open-tracking redirect domain over HTTPS.
 *
 *   viewer ──HTTPS──► CloudFront (this stack)
 *       /.well-known/*  ──► private S3 bucket (AASA / assetlinks.json)   [cached]
 *       everything else ──► r.us-west-2.awstrack.me, Host header forwarded [uncached]
 *
 * SES maps a redirect request to the right config set by the Host header, so the
 * CloudFront → origin hop MUST forward the viewer's Host (docs: "The CDN must pass
 * the Host header supplied by the requester to the origin").
 *
 * The AASA lets iOS open the app directly from a tracked link. iOS matches
 * Universal Links on the INITIAL URL's host, never on the redirect target, so the
 * association must live on THIS host, not on wrotate.com.
 */
export class ClickTrackingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClickTrackingStackProps) {
    super(scope, id, props);

    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "Certificate",
      props.certificateArn,
    );

    // ---- Well-known files (AASA) --------------------------------------------
    const wellKnownBucket = new s3.Bucket(this, "WellKnownBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Apple fetches the AASA with no extension; serve it as JSON explicitly.
    new s3deploy.BucketDeployment(this, "WellKnownFiles", {
      destinationBucket: wellKnownBucket,
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "assets"))],
      contentType: "application/json",
      cacheControl: [s3deploy.CacheControl.maxAge(cdk.Duration.hours(1))],
      prune: true,
    });

    // ---- Distribution ---------------------------------------------------------
    const sesOrigin = new origins.HttpOrigin(props.sesTrackingOrigin, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
    });

    // Forward Host + every query string; never cache redirects.
    const forwardHost = new cloudfront.OriginRequestPolicy(this, "ForwardHostToSes", {
      originRequestPolicyName: `${props.domainName.replace(/\./g, "-")}-forward-host`,
      comment: "SES custom redirect domain: pass viewer Host + query strings to awstrack.me",
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        "Host",
        "User-Agent",
        "Accept",
        "Accept-Language",
        "Referer",
      ),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `${props.domainName} — SES click/open tracking redirect + AASA`,
      domainNames: [props.domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: sesOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: forwardHost,
        compress: false,
      },
      additionalBehaviors: {
        "/.well-known/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(wellKnownBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          compress: true,
        },
      },
    });

    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
      description: `Point ${props.domainName} CNAME here (Cloudflare: DNS only / grey cloud)`,
    });
    new cdk.CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new cdk.CfnOutput(this, "AasaUrl", {
      value: `https://${props.domainName}/.well-known/apple-app-site-association`,
    });
  }
}
