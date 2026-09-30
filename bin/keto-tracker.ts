#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { KetoTrackerStack } from '../lib/keto-tracker-stack';

const app = new cdk.App();

// Single stack in us-west-2 per the design doc. Pass context on the command line:
//   cdk deploy -c usdaApiKey=XXXX -c alarmEmail=you@example.com
new KetoTrackerStack(app, 'KetoTracker', {
  env: { region: 'us-west-2' },
  description: 'Keto Meal Tracker — serverless stack (API Gateway + Lambda + DynamoDB + Cognito + CloudFront)',
});
