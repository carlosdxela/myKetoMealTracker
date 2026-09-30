/**
 * Shared nutrition math — the single source of truth for keto calculations.
 * Imported by BOTH the Lambda backend and the React frontend so the numbers
 * always agree. Keep this file dependency-free.
 */

export interface Nutrients {
  fat: number; // grams
  protein: number; // grams
  carbs: number; // total carbs, grams
  fiber: number; // grams
  calories: number; // kcal
}

export interface IngredientLine {
  name: string;
  fdcId?: number;
  grams: number;
  /** nutrients per 100g */
  per100g: Nutrients;
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const zeroNutrients = (): Nutrients => ({
  fat: 0,
  protein: 0,
  carbs: 0,
  fiber: 0,
  calories: 0,
});

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Scale per-100g nutrients to a gram amount. */
export function scaleNutrients(per100g: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  return {
    fat: round1(per100g.fat * f),
    protein: round1(per100g.protein * f),
    carbs: round1(per100g.carbs * f),
    fiber: round1(per100g.fiber * f),
    calories: Math.round(per100g.calories * f),
  };
}

/** Net carbs = total carbs - fiber, floored at 0. */
export function netCarbs(n: Pick<Nutrients, 'carbs' | 'fiber'>): number {
  return Math.max(0, round1(n.carbs - n.fiber));
}

/**
 * Classic ketogenic ratio = fat grams / (protein grams + net carb grams).
 * Returns null when there is nothing meaningful to divide.
 */
export function ketoRatio(n: Nutrients): number | null {
  const denom = n.protein + netCarbs(n);
  if (denom <= 0) return null;
  return round2(n.fat / denom);
}

/** Sum a list of ingredient lines into meal totals. */
export function sumNutrients(lines: Array<{ grams: number; per100g: Nutrients }>): Nutrients {
  const total = zeroNutrients();
  for (const l of lines) {
    const s = scaleNutrients(l.per100g, l.grams);
    total.fat += s.fat;
    total.protein += s.protein;
    total.carbs += s.carbs;
    total.fiber += s.fiber;
    total.calories += s.calories;
  }
  total.fat = round1(total.fat);
  total.protein = round1(total.protein);
  total.carbs = round1(total.carbs);
  total.fiber = round1(total.fiber);
  total.calories = Math.round(total.calories);
  return total;
}

/**
 * Grams of pure fat to add so the meal reaches `target` ratio.
 * Returns 0 when already at or above target.
 */
export function fatNeededForRatio(totals: Nutrients, target: number): number {
  const denom = totals.protein + netCarbs(totals);
  if (denom <= 0) return 0;
  const needed = target * denom - totals.fat;
  return needed > 0 ? Math.ceil(needed) : 0;
}

export type RatioStatus = 'hit' | 'below' | 'empty';

export function ratioStatus(ratio: number | null, target: number): RatioStatus {
  if (ratio === null) return 'empty';
  return ratio >= target ? 'hit' : 'below';
}
