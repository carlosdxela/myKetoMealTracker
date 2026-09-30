/**
 * USDA FoodData Central proxy with DynamoDB result caching.
 * The API key lives only in the Lambda environment — never in the repo or frontend.
 */
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE } from './db.js';

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

export interface UsdaPer100g {
  fat: number;
  protein: number;
  carbs: number;
  fiber: number;
  calories: number;
}

export interface UsdaFood {
  fdcId: number;
  description: string;
  per100g: UsdaPer100g;
}

// USDA nutrient IDs: fat 1004, protein 1003, carbs 1005, fiber 1079, energy 1008
function nutrientOf(food: any, ids: number[]): number {
  const list: any[] = food.foodNutrients ?? [];
  const n = list.find((x) => ids.includes(x?.nutrient?.id ?? x?.nutrientId));
  const v = n ? Number(n.value ?? n.amount ?? 0) : 0;
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function toFood(item: any): UsdaFood {
  return {
    fdcId: item.fdcId,
    description: item.description ?? 'Unknown food',
    per100g: {
      fat: nutrientOf(item, [1004]),
      protein: nutrientOf(item, [1003]),
      carbs: nutrientOf(item, [1005]),
      fiber: nutrientOf(item, [1079]),
      calories: nutrientOf(item, [1008]),
    },
  };
}

export async function searchUsda(query: string, userId: string): Promise<UsdaFood[]> {
  const key = process.env.USDA_API_KEY;
  if (!key) {
    throw Object.assign(new Error('USDA_API_KEY is not configured on the server'), { status: 500 });
  }
  const url =
    `${USDA_BASE}/foods/search?api_key=${encodeURIComponent(key)}` +
    `&query=${encodeURIComponent(query)}&pageSize=10`;
  const res = await fetch(url);
  if (!res.ok) {
    throw Object.assign(new Error(`USDA search failed (HTTP ${res.status})`), { status: 502 });
  }
  const data: any = await res.json();
  const foods: UsdaFood[] = (data.foods ?? []).map(toFood);

  // Cache hits so repeat searches don't burn USDA quota.
  const now = new Date().toISOString();
  await Promise.all(
    foods.map((f) =>
      ddb
        .send(
          new PutCommand({
            TableName: TABLE,
            Item: {
              PK: `USER#${userId}`,
              SK: `INGREDIENT#${f.fdcId}`,
              kind: 'ingredient',
              fdcId: f.fdcId,
              name: f.description,
              per100g: f.per100g,
              fetchedAt: now,
            },
          }),
        )
        .catch((e) => console.warn('ingredient cache write failed', e)),
    ),
  );
  return foods;
}
