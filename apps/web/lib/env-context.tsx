"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";

export interface Env {
  id: string;
  name: string;
  label: string;
  color: string;
  sortOrder: number;
}

interface EnvContextValue {
  env: string;           // active env name ('staging', 'prod', etc.)
  setEnv: (name: string) => void;
  environments: Env[];
  reloadEnvs: () => Promise<void>;
  // Fetch wrapper — adds X-Anway-Env header to every request
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const EnvContext = createContext<EnvContextValue>({
  env: "prod",
  setEnv: () => {},
  environments: [],
  reloadEnvs: async () => {},
  apiFetch: (url, init) => fetch(url, init),
});

const STORAGE_KEY = "anway-env";

export function EnvProvider({ children }: { children: ReactNode }) {
  const [env, setEnvState] = useState<string>("prod");
  const [environments, setEnvironments] = useState<Env[]>([]);
  const envRef = useRef(env);
  useEffect(() => { envRef.current = env; }, [env]);

  const setEnv = useCallback((name: string) => {
    setEnvState(name);
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* ignore */ }
  }, []);

  const reloadEnvs = useCallback(async () => {
    try {
      const r = await fetch("/api/environments");
      if (r.ok) {
        const data = await r.json() as Env[];
        setEnvironments(data);
        // If stored env no longer exists, switch to first
        const stored = (() => { try { return localStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; } })();
        const names = data.map(e => e.name);
        if (stored && names.includes(stored)) {
          setEnvState(stored);
        } else if (names.length > 0) {
          setEnvState(names[0]!);
          try { localStorage.setItem(STORAGE_KEY, names[0]!); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void reloadEnvs();
  }, [reloadEnvs]);

  // Global fetch interceptor: attach X-Anway-Env to every same-origin /api
  // call. Found in manual testing: only 3 of ~25 views used the apiFetch
  // wrapper below, so for everything else the env header never left the
  // browser and the env switcher changed nothing. One interceptor makes the
  // active env authoritative for ALL views without touching each component.
  useEffect(() => {
    const original = window.fetch;
    const wrapped: typeof window.fetch = (input, init) => {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const sameOriginApi = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
        if (sameOriginApi) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (!headers.has("X-Anway-Env")) headers.set("X-Anway-Env", envRef.current);
          return original(input, { ...init, headers });
        }
      } catch { /* fall through to original */ }
      return original(input, init);
    };
    window.fetch = wrapped;
    return () => { window.fetch = original; };
  }, []);

  const apiFetch = useCallback((url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    headers.set("X-Anway-Env", env);
    return fetch(url, { ...init, headers });
  }, [env]);

  return (
    <EnvContext.Provider value={{ env, setEnv, environments, reloadEnvs, apiFetch }}>
      {children}
    </EnvContext.Provider>
  );
}

export function useEnv() {
  return useContext(EnvContext);
}
