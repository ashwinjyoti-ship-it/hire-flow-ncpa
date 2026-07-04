/**
 * Client-side auth state. Reads session cookie via /api/auth/me on mount.
 * Phase 3 will implement the real backing; this stub keeps the build green.
 */
import { useQuery } from "@tanstack/react-query";
import type { AuthUser } from "../../worker/env";

async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json()) as { user?: AuthUser };
  return data.user ?? null;
}

export function useAuth() {
  const query = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
  });
  return {
    user: query.data ?? null,
    loading: query.isLoading,
    refetch: query.refetch,
  };
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login";
}
