import { useQuery } from "@tanstack/react-query";
import type { Task } from "@shared/schema";

export function useTasks() {
  return useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });
}

export function useTask(id: number) {
  return useQuery<Task>({
    queryKey: ["/api/tasks", id],
    enabled: !!id,
  });
}
