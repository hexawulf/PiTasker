import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { List, Play, Edit, Trash2, Database, FolderSync, Fan, Clock, Server, CheckCircle2, AlertCircle, XCircle, RefreshCw, Upload, Download } from "lucide-react";
import { useTasks } from "@/hooks/useTasks";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ConfirmationModal from "@/components/ConfirmationModal";
import EditTaskModal from "@/components/EditTaskModal";
import type { Task } from "@shared/schema";

const getStatusBadge = (status: string) => {
  switch (status) {
    case "running":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          <Play className="mr-1 h-3 w-3" />
          Running
        </Badge>
      );
    case "success":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
          Success
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
          Failed
        </Badge>
      );
    default:
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
          Pending
        </Badge>
      );
  }
};

const getTaskIcon = (command: string) => {
  if (command.includes("pg_dump") || command.includes("database") || command.includes("backup")) {
    return <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
  }
  if (command.includes("update") || command.includes("upgrade")) {
    return <FolderSync className="h-5 w-5 text-purple-600 dark:text-purple-400" />;
  }
  if (command.includes("clean") || command.includes("delete") || command.includes("find")) {
    return <Fan className="h-5 w-5 text-red-600 dark:text-red-400" />;
  }
  return <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />;
};

const formatCronDescription = (cron: string) => {
  // Simple cron descriptions for common patterns
  const patterns: Record<string, string> = {
    "0 2 * * *": "Daily at 2:00 AM",
    "0 3 * * 0": "Weekly on Sunday at 3:00 AM",
    "0 1 1 * *": "Monthly on 1st at 1:00 AM",
    "*/15 * * * *": "Every 15 minutes",
    "0 */6 * * *": "Every 6 hours",
    "0 0 * * 1": "Weekly on Monday at midnight",
  };
  
  return patterns[cron] || "Custom schedule";
};

const formatLastRun = (lastRun: string | Date | null) => {
  if (!lastRun) return "Never";
  
  const date = new Date(lastRun);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
};

export default function TaskList() {
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; task: Task | null; action: 'run' | 'delete' }>({
    isOpen: false,
    task: null,
    action: 'run'
  });
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tasks, isLoading } = useTasks();

  const runTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const response = await apiRequest("POST", `/api/tasks/${taskId}/run`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      toast({
        title: "Task Started",
        description: "The task has been started successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to run task",
        variant: "destructive",
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await apiRequest("DELETE", `/api/tasks/${taskId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      toast({
        title: "Task Deleted",
        description: "The task has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete task",
        variant: "destructive",
      });
    },
  });

  const toggleSystemManagedMutation = useMutation({
    mutationFn: async (taskId: number) => {
      const response = await apiRequest("POST", `/api/tasks/${taskId}/toggle-system-managed`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "System Management Toggled",
        description: "The task's system management status has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to toggle system management",
        variant: "destructive",
      });
    },
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/crontab/export");
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Sync Complete",
        description: `${data.exported} tasks synced to crontab, ${data.failed} failed.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to sync tasks",
        variant: "destructive",
      });
    },
  });

  const handleRunTask = (task: Task) => {
    if (task.status === "running") {
      toast({
        title: "Task Already Running",
        description: "This task is currently running.",
        variant: "destructive",
      });
      return;
    }
    setConfirmModal({ isOpen: true, task, action: 'run' });
  };

  const handleDeleteTask = (task: Task) => {
    setConfirmModal({ isOpen: true, task, action: 'delete' });
  };

  const handleEditTask = (task: Task) => {
    setEditTask(task);
    setIsEditOpen(true);
  };

  const handleConfirmAction = () => {
    if (!confirmModal.task) return;
    
    if (confirmModal.action === 'run') {
      runTaskMutation.mutate(confirmModal.task.id);
    } else if (confirmModal.action === 'delete') {
      deleteTaskMutation.mutate(confirmModal.task.id);
    }
    
    setConfirmModal({ isOpen: false, task: null, action: 'run' });
  };

  const getSyncStatusBadge = (task: Task) => {
    if (!task.isSystemManaged) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600">
                <Database className="mr-1 h-3 w-3" />
                DB Only
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Runs via PiTasker only (not in system crontab)</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    if (task.syncedToCrontab && task.crontabSyncedAt) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-green-300 dark:border-green-700">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Synced
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Synced to system crontab</p>
              <p className="text-xs text-gray-400">
                {new Date(task.crontabSyncedAt).toLocaleString()}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700">
              <AlertCircle className="mr-1 h-3 w-3" />
              Not Synced
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Needs sync to system crontab</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const getSourceBadge = (task: Task) => {
    const source = task.source || "pitasker";
    const badges = {
      pitasker: { label: "PiTasker", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
      crontab: { label: "Imported", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
      imported: { label: "Imported", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
    };
    const badge = badges[source as keyof typeof badges] || badges.pitasker;
    return <Badge variant="outline" className={badge.className}>{badge.label}</Badge>;
  };

  const filteredTasks = tasks?.filter((task) => {
    if (filter === "all") return true;
    if (filter === "system-managed") return task.isSystemManaged;
    if (filter === "database-only") return !task.isSystemManaged;
    if (filter === "not-synced") return task.isSystemManaged && !task.syncedToCrontab;
    return true;
  }) || [];

  if (isLoading) {
    return (
      <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <CardContent className="p-8 text-center">
          <div className="text-gray-500 dark:text-gray-400">Loading tasks...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <CardHeader className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center text-gray-900 dark:text-white">
                <List className="mr-2 h-5 w-5 text-blue-600 dark:text-blue-400" />
                Task List
              </CardTitle>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">Auto-refresh: </span>
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filter tasks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="system-managed">System Managed</SelectItem>
                  <SelectItem value="database-only">Database Only</SelectItem>
                  <SelectItem value="not-synced">Not Synced</SelectItem>
                </SelectContent>
              </Select>
              
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => syncAllMutation.mutate()}
                  disabled={syncAllMutation.isPending}
                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  <Upload className="mr-1 h-4 w-4" />
                  Sync All to Crontab
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-0">
          {!filteredTasks || filteredTasks.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-gray-500 dark:text-gray-400">
                {filter === "all" 
                  ? "No tasks found. Create your first task to get started!"
                  : `No tasks match the "${filter}" filter.`}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50 dark:bg-gray-700">
                  <TableRow>
                    <TableHead className="text-gray-500 dark:text-gray-300">Name</TableHead>
                    <TableHead className="text-gray-500 dark:text-gray-300">Schedule</TableHead>
                    <TableHead className="text-gray-500 dark:text-gray-300">Status</TableHead>
                    <TableHead className="text-gray-500 dark:text-gray-300">Crontab Sync</TableHead>
                    <TableHead className="text-gray-500 dark:text-gray-300">Last Run</TableHead>
                    <TableHead className="text-gray-500 dark:text-gray-300 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="bg-white dark:bg-gray-800">
                  {filteredTasks.map((task) => (
                    <TableRow key={task.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <TableCell>
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                              {getTaskIcon(task.command)}
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">{task.name}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 font-mono truncate max-w-xs">
                              {task.command}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900 dark:text-white font-mono">{task.cronSchedule}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {formatCronDescription(task.cronSchedule)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getStatusBadge(task.status)}
                          {getSourceBadge(task)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {getSyncStatusBadge(task)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                        {formatLastRun(task.lastRun)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRunTask(task)}
                                  disabled={task.status === "running"}
                                  className="text-green-600 hover:text-green-900 dark:text-green-400 dark:hover:text-green-300"
                                >
                                  <Play className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Run Now</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleSystemManagedMutation.mutate(task.id)}
                                  disabled={toggleSystemManagedMutation.isPending}
                                  className="text-purple-600 hover:text-purple-900 dark:text-purple-400 dark:hover:text-purple-300"
                                >
                                  <Server className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{task.isSystemManaged ? "Disable" : "Enable"} System Management</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditTask(task)}
                                  className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Edit Task</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteTask(task)}
                                  className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Delete Task</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, task: null, action: 'run' })}
        onConfirm={handleConfirmAction}
        task={confirmModal.task}
        action={confirmModal.action}
        isLoading={runTaskMutation.isPending || deleteTaskMutation.isPending}
      />
      <EditTaskModal
        isOpen={isEditOpen}
        onClose={() => { setIsEditOpen(false); setEditTask(null); }}
        task={editTask}
      />
    </>
  );
}
