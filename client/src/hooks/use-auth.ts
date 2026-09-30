import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError, queryClient } from "@/lib/api";

export type SessionUser = { id: number; username: string };

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
  const logout = useMutation({
    mutationFn: () => api("POST", "/api/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(["/api/auth/me"], null);
    },
  });
  return { user: me.data, isLoading: me.isLoading, logout: () => logout.mutate(), isLogoutPending: logout.isPending };
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const r = await api<{ user: SessionUser }>("POST", "/api/auth/login", { username, password });
  queryClient.setQueryData(["/api/auth/me"], r.user);
  return r.user;
}
