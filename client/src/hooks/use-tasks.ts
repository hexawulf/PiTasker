import { useQuery } from "@tanstack/react-query";
import type { TaskView } from "@shared/schema";

export const TASKS_KEY = ["/api/tasks"];

export function useTasks() {
  return useQuery<TaskView[]>({
    queryKey: TASKS_KEY,
    // Poll faster while a PiTasker run is in progress.
    refetchInterval: (q) => (q.state.data?.some((t) => t.lastRunInfo?.status === "running") ? 2_000 : 15_000),
  });
}
