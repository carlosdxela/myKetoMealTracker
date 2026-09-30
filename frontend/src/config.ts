export const config = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  region: (import.meta.env.VITE_REGION as string | undefined) ?? 'us-west-2',
  userPoolId: (import.meta.env.VITE_USER_POOL_ID as string | undefined) ?? '',
  userPoolClientId: (import.meta.env.VITE_USER_POOL_CLIENT_ID as string | undefined) ?? '',
};

export function configError(): string | null {
  const missing: string[] = [];
  if (!config.apiUrl) missing.push('VITE_API_URL');
  if (!config.userPoolId) missing.push('VITE_USER_POOL_ID');
  if (!config.userPoolClientId) missing.push('VITE_USER_POOL_CLIENT_ID');
  return missing.length ? `Missing frontend config: ${missing.join(', ')}. See frontend/.env.example.` : null;
}
