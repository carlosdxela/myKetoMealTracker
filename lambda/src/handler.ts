/**
 * Keto Tracker API — single Lambda behind API Gateway HTTP API.
 * Auth: Cognito JWT authorizer at the API Gateway layer; user id comes from
 * the token's `sub` claim. All data is scoped to PK = USER#<sub>.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db.js';
import { searchUsda } from './usda.js';
import { sumNutrients, ketoRatio, netCarbs, MEAL_SLOTS } from '../../shared/macro-math.js';

type Slot = (typeof MEAL_SLOTS)[number];

interface IngredientInput {
  name: string;
  fdcId?: number;
  grams: number;
  per100g: { fat: number; protein: number; carbs: number; fiber: number; calories: number };
}

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const err = (status: number, message: string) => json(status, { error: message });

function getUserId(e: APIGatewayProxyEventV2): string {
  const claims = (e.requestContext as any)?.authorizer?.jwt?.claims;
  return typeof claims?.sub === 'string' && claims.sub ? claims.sub : 'local';
}

const PK = (u: string) => `USER#${u}`;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

function mealKey(userId: string, date: string, slot: string, id: string) {
  return { PK: PK(userId), SK: `MEAL#${date}#${slot}#${id}` };
}

/** Attach computed totals / net carbs / ratio to a meal or template item. */
function withTotals<T extends { ingredients: IngredientInput[] }>(item: T) {
  const totals = sumNutrients(item.ingredients);
  return { ...item, totals, netCarbs: netCarbs(totals), ratio: ketoRatio(totals) };
}

function parseBody(e: APIGatewayProxyEventV2): any {
  if (!e.body) return {};
  try {
    return JSON.parse(e.isBase64Encoded ? Buffer.from(e.body, 'base64').toString('utf8') : e.body);
  } catch {
    return null;
  }
}

function validSlot(s: unknown): s is Slot {
  return typeof s === 'string' && (MEAL_SLOTS as readonly string[]).includes(s);
}

function validDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const NUT_KEYS = ['fat', 'protein', 'carbs', 'fiber', 'calories'] as const;

function validIngredients(list: unknown): list is IngredientInput[] {
  return (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every(
      (i: any) =>
        typeof i?.name === 'string' &&
        i.name.length > 0 &&
        typeof i?.grams === 'number' &&
        i.grams > 0 &&
        i.grams <= 5000 &&
        i?.per100g &&
        NUT_KEYS.every((k) => typeof i.per100g[k] === 'number' && i.per100g[k] >= 0),
    )
  );
}

function stripKey(item: Record<string, any>) {
  const { PK: _p, SK: _s, ...rest } = item;
  return rest;
}

// ---------------- meals ----------------

async function listMeals(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const date = e.queryStringParameters?.date;
  if (!validDate(date)) return err(400, 'query param date=YYYY-MM-DD is required');
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': PK(userId), ':sk': `MEAL#${date}#` },
    }),
  );
  const meals = (r.Items ?? [])
    .map((m) => withTotals(stripKey(m) as any))
    .sort((a: any, b: any) => String(a.SK ?? a.id).localeCompare(String(b.SK ?? b.id)));
  return json(200, { date, meals });
}

async function createMeal(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const b = parseBody(e);
  if (b === null) return err(400, 'invalid JSON body');
  const date: unknown = b.date ?? todayStr();
  const { slot, name = '', ingredients } = b;
  if (!validDate(date)) return err(400, 'date must be YYYY-MM-DD');
  if (!validSlot(slot)) return err(400, `slot must be one of ${MEAL_SLOTS.join(', ')}`);
  if (!validIngredients(ingredients)) {
    return err(400, 'ingredients must be a non-empty array of {name, grams>0, per100g{...}}');
  }
  const id = newId();
  const now = new Date().toISOString();
  const item = withTotals({
    id,
    date,
    slot,
    name: String(name).slice(0, 80),
    ingredients,
    createdAt: now,
    updatedAt: now,
    ...mealKey(userId, date, slot, id),
  });
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return json(201, stripKey(item));
}

async function updateMeal(e: APIGatewayProxyEventV2, id: string) {
  const userId = getUserId(e);
  const b = parseBody(e);
  if (b === null) return err(400, 'invalid JSON body');
  const { date, slot } = b;
  if (!validDate(date) || !validSlot(slot)) {
    return err(400, 'date and slot are required to locate the meal');
  }
  const key = mealKey(userId, date, slot, id);
  const cur = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (!cur.Item) return err(404, 'meal not found');
  const ingredients = b.ingredients ?? cur.Item.ingredients;
  if (!validIngredients(ingredients)) return err(400, 'invalid ingredients');
  const item = withTotals({
    ...cur.Item,
    name: typeof b.name === 'string' ? String(b.name).slice(0, 80) : cur.Item.name,
    ingredients,
    updatedAt: new Date().toISOString(),
  });
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return json(200, stripKey(item));
}

async function deleteMeal(e: APIGatewayProxyEventV2, id: string) {
  const userId = getUserId(e);
  const q = e.queryStringParameters ?? {};
  if (!validDate(q.date) || !validSlot(q.slot)) {
    return err(400, 'query params date and slot are required');
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: mealKey(userId, q.date, q.slot, id) }));
  return json(200, { deleted: id });
}

// ---------------- templates ----------------

async function listTemplates(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const r = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': PK(userId), ':sk': 'TEMPLATE#' },
    }),
  );
  const templates = (r.Items ?? []).map((t) => withTotals(stripKey(t) as any));
  return json(200, { templates });
}

async function createTemplate(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const b = parseBody(e);
  if (b === null) return err(400, 'invalid JSON body');
  const { name = '', ingredients } = b;
  if (typeof name !== 'string' || !name.trim()) return err(400, 'name is required');
  if (!validIngredients(ingredients)) return err(400, 'invalid ingredients');
  const id = newId();
  const item = withTotals({
    id,
    name: name.trim().slice(0, 80),
    ingredients,
    createdAt: new Date().toISOString(),
    PK: PK(userId),
    SK: `TEMPLATE#${id}`,
  });
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return json(201, stripKey(item));
}

async function deleteTemplate(e: APIGatewayProxyEventV2, id: string) {
  const userId = getUserId(e);
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: PK(userId), SK: `TEMPLATE#${id}` } }));
  return json(200, { deleted: id });
}

/** Copy-on-instantiate: a template's ingredients are deep-copied into a new meal. */
async function mealFromTemplate(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const b = parseBody(e);
  if (b === null) return err(400, 'invalid JSON body');
  const { templateId, slot } = b;
  const date: unknown = b.date ?? todayStr();
  if (typeof templateId !== 'string' || !templateId) return err(400, 'templateId is required');
  if (!validDate(date)) return err(400, 'date must be YYYY-MM-DD');
  if (!validSlot(slot)) return err(400, `slot must be one of ${MEAL_SLOTS.join(', ')}`);
  const t = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { PK: PK(userId), SK: `TEMPLATE#${templateId}` } }),
  );
  if (!t.Item) return err(404, 'template not found');
  const id = newId();
  const now = new Date().toISOString();
  const ingredients = JSON.parse(JSON.stringify(t.Item.ingredients)) as IngredientInput[];
  const item = withTotals({
    id,
    date,
    slot,
    name: t.Item.name,
    ingredients,
    fromTemplate: templateId,
    createdAt: now,
    updatedAt: now,
    ...mealKey(userId, date, slot, id),
  });
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return json(201, stripKey(item));
}

// ---------------- settings ----------------

async function getSettings(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: PK(userId), SK: 'SETTINGS' } }));
  const { PK: _p, SK: _s, ...rest } = r.Item ?? {};
  return json(200, { ratioTarget: 3, ...rest });
}

async function putSettings(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const b = parseBody(e);
  if (b === null) return err(400, 'invalid JSON body');
  const ratioTarget = Number(b.ratioTarget);
  if (!Number.isFinite(ratioTarget) || ratioTarget <= 0 || ratioTarget > 10) {
    return err(400, 'ratioTarget must be a number between 0 and 10');
  }
  const item = {
    PK: PK(userId),
    SK: 'SETTINGS',
    ratioTarget: Math.round(ratioTarget * 10) / 10,
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return json(200, { ratioTarget: item.ratioTarget });
}

// ---------------- ingredient search ----------------

async function searchIngredients(e: APIGatewayProxyEventV2) {
  const userId = getUserId(e);
  const q = e.queryStringParameters?.q?.trim();
  if (!q || q.length < 2) return err(400, 'query param q (min 2 chars) is required');
  try {
    const results = await searchUsda(q, userId);
    return json(200, { results });
  } catch (e2: any) {
    return err(e2?.status ?? 500, e2?.message ?? 'ingredient search failed');
  }
}

// ---------------- router ----------------

export const handler = async (e: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const method = e.requestContext.http.method;
    const raw = e.rawPath || '/';
    const noTrail = raw.replace(/\/+$/, '') || '/';
    // With the $default stage, rawPath is already /api/...; with a named stage, strip it.
    const p = noTrail.startsWith('/api/') ? noTrail : noTrail.replace(/^\/[^/]+/, '');

    if (method === 'OPTIONS') return json(200, {});
    if (p === '/api/meals' && method === 'GET') return listMeals(e);
    if (p === '/api/meals' && method === 'POST') return createMeal(e);
    if (p === '/api/meals/from-template' && method === 'POST') return mealFromTemplate(e);
    let m = p.match(/^\/api\/meals\/([^/]+)$/);
    if (m && method === 'PUT') return updateMeal(e, m[1]);
    if (m && method === 'DELETE') return deleteMeal(e, m[1]);
    if (p === '/api/templates' && method === 'GET') return listTemplates(e);
    if (p === '/api/templates' && method === 'POST') return createTemplate(e);
    m = p.match(/^\/api\/templates\/([^/]+)$/);
    if (m && method === 'DELETE') return deleteTemplate(e, m[1]);
    if (p === '/api/settings' && method === 'GET') return getSettings(e);
    if (p === '/api/settings' && method === 'PUT') return putSettings(e);
    if (p === '/api/ingredients/search' && method === 'GET') return searchIngredients(e);
    return err(404, `no route for ${method} ${p}`);
  } catch (e2) {
    console.error('unhandled error', e2);
    return err(500, 'internal error');
  }
};
