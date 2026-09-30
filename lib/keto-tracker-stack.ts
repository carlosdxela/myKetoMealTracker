import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as budgets from 'aws-cdk-lib/aws-budgets';

/**
 * KetoTrackerStack — implements the design doc's serverless architecture.
 *
 * Deviation note (recorded): the design doc recommends AWS Amplify Hosting for
 * the SPA. Amplify-via-CDK needs a GitHub personal access token at synth time,
 * which we don't want to bake into automation. This stack instead serves the
 * SPA from S3 + CloudFront with Origin Access Control — same properties the
 * doc asks for (free HTTPS URL, zero domain setup, CDN) and fully automated
 * via `cdk deploy`. The README documents how to point Amplify Hosting at this
 * repo later if you prefer its git-CI workflow.
 */
export class KetoTrackerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- DynamoDB single table ----------
    const table = new dynamodb.Table(this, 'KetoTable', {
      tableName: 'keto_tracker',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // on-demand, free-tier friendly
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never drop user data on stack updates
    });

    // ---------- Cognito: single-user login ----------
    const pool = new cognito.UserPool(this, 'KetoUsers', {
      userPoolName: 'keto-tracker-users',
      signInAliases: { email: true },
      selfSignUpEnabled: true,
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const webClient = pool.addClient('KetoWebClient', {
      userPoolClientName: 'keto-web',
      generateSecret: false, // public SPA client
      authFlows: { userPassword: true, userSrp: true },
    });

    // ---------- Lambda: one function serving all API routes ----------
    const usdaApiKey = this.node.tryGetContext('usdaApiKey') as string | undefined;
    const apiFn = new nodejs.NodejsFunction(this, 'KetoApi', {
      functionName: 'keto-api',
      entry: 'lambda/src/handler.ts',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(20),
      environment: {
        TABLE_NAME: table.tableName,
        USDA_API_KEY: usdaApiKey ?? '',
      },
      bundling: {
        // AWS SDK v3 ships in the Lambda runtime; keep the bundle small.
        externalModules: ['@aws-sdk/*'],
      },
    });
    table.grantReadWriteData(apiFn);

    // ---------- API Gateway HTTP API + Cognito JWT authorizer ----------
    const jwtAuthorizer = new authorizers.HttpUserPoolAuthorizer('CognitoAuthorizer', pool, {
      userPoolClients: [webClient],
    });
    const httpApi = new apigwv2.HttpApi(this, 'KetoHttpApi', {
      apiName: 'keto-tracker-api',
      corsPreflight: {
        // TODO: after the first deploy, tighten this to the CloudFront domain
        // (see the FrontendUrl output) instead of '*'.
        allowOrigins: ['*'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['content-type', 'authorization'],
      },
      defaultAuthorizer: jwtAuthorizer,
    });
    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('LambdaIntegration', apiFn),
    });

    // ---------- Frontend hosting: S3 + CloudFront (HTTPS, CDN) ----------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `keto-tracker-site-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      versioned: false,
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      // SPA fallback: serve index.html for client-side routes / missing objects.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });

    // Deploys ./frontend/dist on every `cdk deploy` (build the frontend first).
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset('./frontend/dist')],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ---------- Budget alarm: $5/month ----------
    const alarmEmail = (this.node.tryGetContext('alarmEmail') as string | undefined) ?? '';
    if (alarmEmail) {
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: 'keto-tracker-monthly',
          budgetLimit: { amount: 5, unit: 'USD' },
          timeUnit: 'MONTHLY',
          budgetType: 'COST',
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100, // percent of budgeted amount
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: alarmEmail }],
          },
        ],
      });
    } else {
      new cdk.CfnOutput(this, 'BudgetAlarmSkipped', {
        value: 'no alarmEmail context provided — rerun with -c alarmEmail=you@example.com to enable the $5 budget alarm',
      });
    }

    // ---------- Outputs (needed for frontend .env) ----------
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint, description: 'VITE_API_URL' });
    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Public HTTPS URL of the app',
    });
    new cdk.CfnOutput(this, 'UserPoolId', { value: pool.userPoolId, description: 'VITE_USER_POOL_ID' });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: webClient.userPoolClientId,
      description: 'VITE_USER_POOL_CLIENT_ID',
    });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
