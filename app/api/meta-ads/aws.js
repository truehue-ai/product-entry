import "server-only";

// One AWS credentials setup for the Meta Ads routes (S3 cache + SSM token): the same Vercel OIDC role
// (AWS_ROLE_ARN) and region the rest of the app's S3Clients use.
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

export const awsRegion = process.env.X_AWS_REGION;
export const awsCredentials = awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN });
