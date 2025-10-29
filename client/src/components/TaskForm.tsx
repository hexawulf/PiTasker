import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, PlusCircle, Clock, Terminal, AlertCircle, Server, Database, CheckCircle2, AlertTriangle, Upload } from "lucide-react";
import { insertTaskSchema, type InsertTask } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ImportCronModal from "@/components/ImportCronModal";

export default function TaskForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSystemManaged, setIsSystemManaged] = useState(true);

  const form = useForm<InsertTask>({
    resolver: zodResolver(insertTaskSchema),
    defaultValues: {
      name: "",
      cronSchedule: "",
      command: "",
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (task: InsertTask) => {
      const response = await apiRequest("POST", "/api/tasks", task);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      form.reset();
      toast({
        title: "Task Created",
        description: "Your task has been created and scheduled successfully.",
      });
    },
    onError: (error: any) => {
      console.error("Task creation error:", error);
      
      // Handle validation errors from server
      if (error?.response?.status === 400 && error?.response?.data?.errors) {
        const validationErrors = error.response.data.errors;
        validationErrors.forEach((err: any) => {
          if (err.path && err.path.length > 0) {
            form.setError(err.path[0] as keyof InsertTask, {
              message: err.message
            });
          }
        });
        toast({
          title: "Validation Error",
          description: "Please check the form for errors and try again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to create task. Please check your inputs and try again.",
          variant: "destructive",
        });
      }
    },
  });

  const onSubmit = (data: InsertTask) => {
    createTaskMutation.mutate({ ...data, isSystemManaged } as any);
  };

  return (
    <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
      <CardHeader className="border-b border-gray-200 dark:border-gray-700">
        <CardTitle className="flex items-center text-gray-900 dark:text-white">
          <PlusCircle className="mr-2 h-5 w-5 text-blue-600 dark:text-blue-400" />
          Add New Task
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 dark:text-gray-300">Task Name</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="e.g., Database Backup" 
                      className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="cronSchedule"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 dark:text-gray-300">Cron Schedule</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="0 2 * * * (Every day at 2 AM)" 
                      className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white font-mono"
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription className="text-gray-500 dark:text-gray-400">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Clock className="h-3 w-3" />
                        <span className="text-xs font-medium">Format: minute hour day month weekday</span>
                      </div>
                      <div className="text-xs space-y-1">
                        <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">0 2 * * *</code> = Daily at 2:00 AM</div>
                        <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">*/15 * * * *</code> = Every 15 minutes</div>
                        <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">0 0 * * 1</code> = Weekly on Monday at midnight</div>
                        <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">30 6 1 * *</code> = Monthly on 1st at 6:30 AM</div>
                      </div>
                    </div>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="command"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 dark:text-gray-300">Shell Command</FormLabel>
                  <FormControl>
                    <Textarea 
                      rows={3}
                      placeholder="echo 'Hello Pi' > /tmp/hello.txt" 
                      className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white font-mono"
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription className="text-gray-500 dark:text-gray-400">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Terminal className="h-3 w-3" />
                        <span className="text-xs font-medium">Pi Examples:</span>
                      </div>
                      <div className="text-xs space-y-1">
                        <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">vcgencmd measure_temp {'>>'} /var/log/pi-temp.log</code></div>
                        <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">tar -czf /backup/$(date +%Y%m%d).tar.gz /home/pi</code></div>
                        <div><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">find /tmp -type f -atime +7 -delete</code></div>
                      </div>
                    </div>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* System Crontab Management Toggle */}
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Server className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">Sync to System Crontab</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {isSystemManaged ? (
                        <span className="flex items-center space-x-1">
                          <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
                          <span>Task will be managed by system crontab</span>
                        </span>
                      ) : (
                        <span className="flex items-center space-x-1">
                          <Database className="h-3 w-3 text-gray-600 dark:text-gray-400" />
                          <span>Task will run via PiTasker only (database-only mode)</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={isSystemManaged}
                  onCheckedChange={setIsSystemManaged}
                  className="data-[state=checked]:bg-blue-600"
                />
              </div>
              
              {isSystemManaged && (
                <Alert className="mt-3 bg-white dark:bg-gray-800 border-blue-300 dark:border-blue-700">
                  <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <AlertDescription className="text-sm text-gray-700 dark:text-gray-300">
                    This task will be automatically added to your system crontab and will run even if PiTasker is stopped.
                  </AlertDescription>
                </Alert>
              )}
              
              {!isSystemManaged && (
                <Alert className="mt-3 bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600">
                  <AlertTriangle className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  <AlertDescription className="text-sm text-gray-700 dark:text-gray-300">
                    This task will only run when PiTasker application is running. It will not be added to system crontab.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            
            <div className="flex space-x-2">
              <Button 
                type="submit" 
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                disabled={createTaskMutation.isPending}
              >
                <Plus className="mr-2 h-4 w-4" />
                {createTaskMutation.isPending ? "Creating..." : "Create Task"}
              </Button>
              
              <ImportCronModal />
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
