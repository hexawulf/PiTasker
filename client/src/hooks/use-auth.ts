import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "@/lib/api";

export type SessionUser = { id: number; username: string };

export interface FirebaseClientConfig {
  enabled: boolean;
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}

export interface AuthConfig {
  firebase?: FirebaseClientConfig;
}

/** null = logged out; undefined = still asking. */
export function useAuth() {
  const me = useQuery<SessionUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        return (await api<{ user: SessionUser }>("GET", "/api/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const authConfig = useQuery<AuthConfig>({
    queryKey: ["/api/auth/config"],
    queryFn: async () => {
      try {
        return await api<AuthConfig>("GET", "/api/auth/config");
      } catch {
        return { firebase: { enabled: false } };
      }
    },
    staleTime: 10 * 60_000,
  });

  const logout = useMutation({
    mutationFn: () => api("POST", "/api/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(["/api/auth/me"], null);
    },
  });

  const firebaseLogin = useMutation({
    mutationFn: async (idToken: string) => {
      const r = await api<{ user: SessionUser }>("POST", "/api/auth/firebase-login", { idToken });
      queryClient.setQueryData(["/api/auth/me"], r.user);
      return r.user;
    },
  });

  return {
    user: me.data,
    isLoading: me.isLoading,
    firebase: authConfig.data?.firebase,
    logout: () => logout.mutate(),
    isLogoutPending: logout.isPending,
    firebaseLogin: firebaseLogin.mutateAsync,
    isFirebaseLoginPending: firebaseLogin.isPending,
  };
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const r = await api<{ user: SessionUser }>("POST", "/api/auth/login", { username, password });
  queryClient.setQueryData(["/api/auth/me"], r.user);
  return r.user;
}
