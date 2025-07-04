import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pause, RefreshCw, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function QuickActions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const refreshMutation = useMutation({
    mutationFn: async () => {
      // Invalidate all queries to refresh data
      await queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
    },
    onSuccess: () => {
      toast({
        title: "Refreshed",
        description: "Task data has been refreshed.",
      });
    },
  });

  const handlePauseAll = () => {
    toast({
      title: "Feature Coming Soon",
      description: "Pause all tasks functionality will be available in a future update.",
    });
  };

  const handleExport = () => {
    toast({
      title: "Feature Coming Soon", 
      description: "Export tasks functionality will be available in a future update.",
    });
  };

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  return (
    <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <CardHeader className="border-b border-gray-200 dark:border-gray-700">
        <CardTitle className="text-gray-900 dark:text-white">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-3">
        <Button
          variant="secondary"
          className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white"
          onClick={handlePauseAll}
        >
          <Pause className="mr-2 h-4 w-4" />
          Pause All Tasks
        </Button>
        <Button
          variant="secondary"
          className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white"
          onClick={handleRefresh}
          disabled={refreshMutation.isPending}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Status'}
        </Button>
        <Button
          variant="secondary"
          className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white"
          onClick={handleExport}
        >
          <Download className="mr-2 h-4 w-4" />
          Export Tasks
        </Button>
      </CardContent>
    </Card>
  );
}
