"use client";
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

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
  // Fetch wrapper — adds X-Anvay-Env header to every request
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const EnvContext = createContext<EnvContextValue>({
  env: "prod",
  setEnv: () => {},
  environments: [],
  reloadEnvs: async () => {},
  apiFetch: (url, init) => fetch(url, init),
});

const STORAGE_KEY = "anvay-env";

export function EnvProvider({ children }: { children: ReactNode }) {
  const [env, setEnvState] = useState<string>("prod");
  const [environments, setEnvironments] = useState<Env[]>([]);

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

  const apiFetch = useCallback((url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers ?? {});
    headers.set("X-Anvay-Env", env);
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
