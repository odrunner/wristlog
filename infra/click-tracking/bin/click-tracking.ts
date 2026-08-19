#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ClickTrackingStack } from "../lib/click-tracking-stack.js";

const app = new cdk.App();

const certificateArn = app.node.tryGetContext("certificateArn") as string | undefined;
if (!certificateArn) {
  throw new Error(
    "Missing context: certificateArn. Request the cert first (see README) and pass " +
      "-c certificateArn=arn:aws:acm:us-east-1:...:certificate/...",
  );
}

// us-east-1 on purpose: CloudFront only accepts ACM certificates from us-east-1.
// The SES sending region (us-west-2) is reflected in sesTrackingOrigin, not here.
new ClickTrackingStack(app, "WrotateClickTracking", {
  env: { account: "392424878015", region: "us-east-1" },
  domainName: "click.wrotate.com",
  sesTrackingOrigin: "r.us-west-2.awstrack.me",
  certificateArn,
  description: "click.wrotate.com - SES HTTPS click-tracking redirect (CloudFront to awstrack.me) plus AASA for iOS Universal Links",
  terminationProtection: true,
});
