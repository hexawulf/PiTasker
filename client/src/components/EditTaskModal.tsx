import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { updateTaskSchema, type UpdateTask, type Task } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
}

export default function EditTaskModal({ isOpen, onClose, task }: EditTaskModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<UpdateTask>({
    resolver: zodResolver(updateTaskSchema),
    defaultValues: {
      name: task?.name ?? "",
      cronSchedule: task?.cronSchedule ?? "",
      command: task?.command ?? "",
    },
  });

  useEffect(() => {
    if (task) {
      form.reset({
        name: task.name,
        cronSchedule: task.cronSchedule,
        command: task.command,
      });
    }
  }, [task, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateTask) => {
      const res = await apiRequest("PATCH", `/api/tasks/${task!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      toast({ title: "Task Updated", description: "The task was updated successfully." });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpdateTask) => {
    updateMutation.mutate(data);
  };

  if (!task) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>Modify the task details below.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-700 dark:text-gray-300">Task Name</FormLabel>
                  <FormControl>
                    <Input className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white" {...field} />
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
                    <Input className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white font-mono" {...field} />
                  </FormControl>
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
                    <Textarea rows={3} className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="flex gap-2">
              <DialogClose asChild>
                <Button variant="secondary" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
