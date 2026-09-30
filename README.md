# Keto Meal Tracker — AWS (CDK)

Serverless keto meal tracker on AWS, per the design doc
(`workspace/your_files/keto-tracker-aws-design/keto-tracker-aws-design.pdf`
in the original workspace — ask Carlos for a copy if you need it).

**What it does:** USDA ingredient search, gram-level meal builder with ±1g
steppers, live ketogenic-ratio checking against a configurable target
(default **3:1**), net carbs = total carbs − fiber, per-date day log with
breakfast/lunch/dinner/snack slots, and reusable templates that are
**copied** (never linked) into a day's log.

**Architecture (us-west-2):**

```
Browser → CloudFront (HTTPS) → S3          static SPA (Vite + React)
Browser → API Gateway HTTP API (Cognito JWT authorizer)
          → Lambda (single function, all /api/* routes)
          → DynamoDB single table `keto_tracker` (on-demand)
          → USDA FoodData Central (key in Lambda env, results cached)
Cognito User Pool                              email/password login
AWS Budgets                                    $5/month alarm (optional)
```

> **Deviation from the design doc, recorded:** the doc recommends AWS
> Amplify Hosting for the SPA. Amplify-via-CDK requires a GitHub personal
> access token at synth time, so this stack serves the SPA from **S3 +
> CloudFront** instead — same properties the doc asks for (free HTTPS URL,
> zero domain setup, CDN) and fully automated via `cdk deploy`. To use
> Amplify Hosting with git CI instead: in the AWS console create an Amplify
> app from this repo (root dir `frontend`, build `npm run build`, artifact
> `dist`), then skip the S3/CloudFront resources.

**Repo layout:**

```
bin/keto-tracker.ts        CDK app entrypoint
lib/keto-tracker-stack.ts  the stack (DynamoDB, Cognito, Lambda, API GW, S3+CF, Budget)
lambda/src/                API handlers (handler.ts router, db.ts, usda.ts)
shared/macro-math.ts       nutrition math shared by backend AND frontend
frontend/                  Vite + React SPA
```

## Prerequisites

1. **Node.js 20+** and npm.
2. **AWS CLI v2** configured (`aws configure`) with credentials that can
   create the resources in the stack, region set to `us-west-2`.
3. **AWS CDK v2**: `npm install -g aws-cdk` (then `cdk --version` to verify).
4. **USDA FoodData Central API key** — free at https://api.data.gov
   (the shared `DEMO_KEY` is rate-limited; get a personal key).
5. **An email address** for the $5 budget alarm (optional but recommended).

No secrets go in the repo. The USDA key is passed as a CDK context value
and lands only in the Lambda function's environment variables.

## Deploy

```bash
# 0. one-time per AWS account/region: bootstrap CDK
cdk bootstrap aws://<ACCOUNT_ID>/us-west-2

# 1. install dependencies
npm install
cd lambda && npm install && cd ..
cd frontend && npm install && cd ..

# 2. build the frontend (output goes to frontend/dist)
cd frontend && npm run build && cd ..

# 3. deploy everything (first deploy also uploads frontend/dist to S3)
cdk deploy -c usdaApiKey=<YOUR_USDA_KEY> -c alarmEmail=you@example.com
```

`cdk deploy` prints outputs — copy these into `frontend/.env`:

| CDK output       | Frontend env var          |
| ---------------- | ------------------------- |
| `ApiUrl`         | `VITE_API_URL`            |
| `UserPoolId`     | `VITE_USER_POOL_ID`       |
| `UserPoolClientId` | `VITE_USER_POOL_CLIENT_ID` |

```bash
# 4. configure + rebuild + redeploy the frontend with real values
cp frontend/.env.example frontend/.env   # then edit it
cd frontend && npm run build && cd ..
cdk deploy -c usdaApiKey=<YOUR_USDA_KEY> -c alarmEmail=you@example.com
```

The `FrontendUrl` output (e.g. `https://d1234abcd.cloudfront.net`) is the
public app URL. Open it, **Sign up** with your email, confirm the code,
sign in — your Cognito user is the only account.

**Local frontend dev** (against the deployed API):

```bash
cd frontend
npm run dev   # http://localhost:5173 — needs frontend/.env filled in
```

## Day-to-day use

- **Builder**: search USDA → Add → tweak grams with the −/+ steppers (1g)
  or type directly. The ratio pill shows live status vs your target and how
  much fat to add. **Log meal** files it under the date/slot;
  **Save as template** stores it for reuse.
- **Day log**: pick a date, review breakfast/lunch/dinner/snack, expand a
  meal, **Save as template** from any logged meal, delete.
- **Templates**: **Add to day** copies a template into a date/slot;
  **Edit in builder** loads it for tweaking first.
- **Settings**: change the target ratio (default 3:1).

## API (all require `Authorization: Bearer <Cognito ID token>`)

| Method & path               | Description                              |
| --------------------------- | ---------------------------------------- |
| `GET /api/meals?date=`      | Day's log, all four slots                |
| `POST /api/meals`           | Create logged meal (validates + totals)  |
| `PUT /api/meals/:id`        | Update (body must include date + slot)   |
| `DELETE /api/meals/:id?date=&slot=` | Remove from log                |
| `GET /api/templates`        | List templates                           |
| `POST /api/templates`       | Save meal-as-template                    |
| `DELETE /api/templates/:id` | Delete template                          |
| `POST /api/meals/from-template` | Copy template into day/slot          |
| `GET /api/settings`         | Read ratio target                        |
| `PUT /api/settings`         | Write ratio target                       |
| `GET /api/ingredients/search?q=` | USDA proxy (cached in DynamoDB)     |

## DynamoDB single table (`keto_tracker`, on-demand)

`PK = USER#<cognito sub>`, `SK` per item kind:

- `MEAL#<date>#<slot>#<id>` — logged meal + ingredient snapshot + totals
- `TEMPLATE#<id>` — reusable template
- `SETTINGS` — `{ ratioTarget }`
- `INGREDIENT#<fdcId>` — USDA cache entry

## Costs (free-tier plan)

Amplify/CloudFront + Lambda + API Gateway + DynamoDB (25 GB) + Cognito
(50k MAU) + CloudWatch Logs stay at **$0** for personal use on a new
account. Optional: custom Route 53 domain (~$10–15/yr + ~$0.50/mo),
Secrets Manager (~$0.40/mo/secret — the USDA key starts as a plain Lambda
env var instead). The $5 budget alarm catches surprises.

## Teardown

```bash
cdk destroy
```

> DynamoDB table, Cognito pool, and the site bucket use `RETAIN` so user
> data survives stack updates and `cdk destroy` won't silently delete it —
> delete them by hand in the console if you truly want everything gone.

## Troubleshooting

- **USDA search returns 500 "USDA_API_KEY is not configured"**: redeploy
  with `-c usdaApiKey=...`.
- **CORS errors**: the stack allows `*` initially (see the TODO in
  `lib/keto-tracker-stack.ts`); tighten to the CloudFront domain after the
  first deploy.
- **`cdk deploy` fails on `frontend/dist` missing**: run
  `cd frontend && npm run build` first — `BucketDeployment` sources that
  directory.
- **Budget alarm email not arriving**: check spam, and confirm the address
  in the AWS Budgets console (it sends a confirmation on creation).
