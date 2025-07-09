import { useQuery } from "@tanstack/react-query";
import type { Task } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";

export function useTasks() {
  return useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    queryFn: getQueryFn<Task[]>({ on401: "returnNull" }),
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });
}

export function useTask(id: number) {
  return useQuery<Task>({
    queryKey: ["/api/tasks", id],
    queryFn: getQueryFn<Task>({ on401: "returnNull" }),
    enabled: !!id,
  });
}
