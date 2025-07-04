import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { ListTodo, Play, CheckCircle, XCircle } from "lucide-react";

interface TaskStats {
  totalTasks: number;
  runningTasks: number;
  successfulTasks: number;
  failedTasks: number;
  pendingTasks: number;
}

export default function StatsCards() {
  const { data: stats } = useQuery<TaskStats>({
    queryKey: ["/api/tasks/stats"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const statCards = [
    {
      title: "Total Tasks",
      value: stats?.totalTasks || 0,
      icon: ListTodo,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      title: "Running",
      value: stats?.runningTasks || 0,
      icon: Play,
      color: "text-green-600 dark:text-green-400",
    },
    {
      title: "Successful",
      value: stats?.successfulTasks || 0,
      icon: CheckCircle,
      color: "text-emerald-600 dark:text-emerald-400",
    },
    {
      title: "Failed",
      value: stats?.failedTasks || 0,
      icon: XCircle,
      color: "text-red-600 dark:text-red-400",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      {statCards.map((stat) => {
        const IconComponent = stat.icon;
        return (
          <Card key={stat.title} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <IconComponent className={`h-8 w-8 ${stat.color}`} />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{stat.title}</p>
                  <p className="text-2xl font-semibold text-gray-900 dark:text-white">{stat.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
