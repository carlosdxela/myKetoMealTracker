import { config } from './config';

/** Shared API + domain types (mirror the Lambda's shapes). */
export interface Per100g {
  fat: number;
  protein: number;
  carbs: number;
  fiber: number;
  calories: number;
}

export interface IngredientLine {
  name: string;
  fdcId?: number;
  grams: number;
  per100g: Per100g;
}

export interface Meal {
  id: string;
  date: string;
  slot: string;
  name: string;
  ingredients: IngredientLine[];
  totals: Per100g;
  netCarbs: number;
  ratio: number | null;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  ingredients: IngredientLine[];
  totals: Per100g;
  netCarbs: number;
  ratio: number | null;
  createdAt: string;
}

export interface IngredientSearchResult {
  fdcId: number;
  description: string;
  per100g: Per100g;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

export function createApi(getToken: () => Promise<string | null>) {
  async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `request failed (${res.status})`;
      throw new ApiError(res.status, msg);
    }
    return data as T;
  }

  return {
    getMeals: (date: string) => req<{ date: string; meals: Meal[] }>(`/api/meals?date=${date}`),
    createMeal: (b: { date: string; slot: string; name: string; ingredients: IngredientLine[] }) =>
      req<Meal>('/api/meals', { method: 'POST', body: JSON.stringify(b) }),
    updateMeal: (id: string, b: { date: string; slot: string; name?: string; ingredients?: IngredientLine[] }) =>
      req<Meal>(`/api/meals/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
    deleteMeal: (id: string, date: string, slot: string) =>
      req<{ deleted: string }>(`/api/meals/${id}?date=${date}&slot=${slot}`, { method: 'DELETE' }),
    listTemplates: () => req<{ templates: Template[] }>('/api/templates'),
    createTemplate: (b: { name: string; ingredients: IngredientLine[] }) =>
      req<Template>('/api/templates', { method: 'POST', body: JSON.stringify(b) }),
    deleteTemplate: (id: string) => req<{ deleted: string }>(`/api/templates/${id}`, { method: 'DELETE' }),
    mealFromTemplate: (b: { templateId: string; date: string; slot: string }) =>
      req<Meal>('/api/meals/from-template', { method: 'POST', body: JSON.stringify(b) }),
    getSettings: () => req<{ ratioTarget: number }>('/api/settings'),
    putSettings: (ratioTarget: number) =>
      req<{ ratioTarget: number }>('/api/settings', { method: 'PUT', body: JSON.stringify({ ratioTarget }) }),
    searchIngredients: (q: string) =>
      req<{ results: IngredientSearchResult[] }>(`/api/ingredients/search?q=${encodeURIComponent(q)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
