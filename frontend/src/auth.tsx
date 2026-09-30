import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { config } from './config';

const pool = new CognitoUserPool({ UserPoolId: config.userPoolId, ClientId: config.userPoolClientId });

function currentUser(): CognitoUser | null {
  return pool.getCurrentUser();
}

function sessionOf(user: CognitoUser): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => user.getSession((e: Error | null, s: CognitoUserSession | null) => (e || !s ? reject(e ?? new Error('no session')) : resolve(s))));
}

interface AuthCtx {
  email: string | null;
  authLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<boolean>; // true if confirmed immediately
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signOut: () => void;
  getToken: () => Promise<string | null>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const u = currentUser();
        if (u) {
          const s = await sessionOf(u);
          if (s.isValid()) setEmail(u.getUsername());
        }
      } catch {
        /* not signed in */
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (em: string, password: string) => {
    const user = new CognitoUser({ Username: em, Pool: pool });
    await new Promise<void>((resolve, reject) =>
      user.authenticateUser(new AuthenticationDetails({ Username: em, Password: password }), {
        onSuccess: () => resolve(),
        onFailure: (e) => reject(e),
        newPasswordRequired: () => reject(new Error('New password required — set it in the AWS console first.')),
      }),
    );
    setEmail(em);
  }, []);

  const signUp = useCallback(async (em: string, password: string): Promise<boolean> => {
    const confirmed = await new Promise<boolean>((resolve, reject) =>
      pool.signUp(em, password, [{ Name: 'email', Value: em }], [], (e, r) => {
        if (e) reject(e);
        else resolve(r?.userConfirmed ?? false);
      }),
    );
    return confirmed;
  }, []);

  const confirmSignUp = useCallback(async (em: string, code: string) => {
    const user = new CognitoUser({ Username: em, Pool: pool });
    await new Promise<void>((resolve, reject) =>
      user.confirmRegistration(code, true, (e) => (e ? reject(e) : resolve())),
    );
  }, []);

  const resendCode = useCallback(async (em: string) => {
    const user = new CognitoUser({ Username: em, Pool: pool });
    await new Promise<void>((resolve, reject) =>
      user.resendConfirmationCode((e) => (e ? reject(e) : resolve())),
    );
  }, []);

  const signOut = useCallback(() => {
    currentUser()?.signOut();
    setEmail(null);
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    const u = currentUser();
    if (!u) return null;
    try {
      const s = await sessionOf(u);
      return s.getIdToken().getJwtToken();
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ email, authLoading, signIn, signUp, confirmSignUp, resendCode, signOut, getToken }),
    [email, authLoading, signIn, signUp, confirmSignUp, resendCode, signOut, getToken],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
