import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CronJob {
  name: string;
  schedule: string;
  command: string;
}

export default function ImportCronModal() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<CronJob[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async (data: CronJob[]) => {
      const res = await apiRequest("POST", "/api/import-cronjobs", data);
      return res.json();
    },
    onSuccess: (data: { imported: number; failed: number }) => {
      toast({
        title: "Import Complete",
        description: `${data.imported} imported, ${data.failed} failed`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      setOpen(false);
      setTasks([]);
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to import tasks",
        variant: "destructive",
      });
    },
  });

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(
            (t) => t.name && t.schedule && t.command,
          ) as CronJob[];
          setTasks(valid);
        } else {
          throw new Error("Invalid format");
        }
      } catch {
        toast({
          title: "Invalid File",
          description: "Could not parse JSON cronjobs",
          variant: "destructive",
        });
        setTasks([]);
      }
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white"
        >
          Import Tasks
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <DialogHeader>
          <DialogTitle>Import Cronjobs</DialogTitle>
          <DialogDescription>Select a JSON file to import.</DialogDescription>
        </DialogHeader>
        <input
          type="file"
          accept=".json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="mt-2"
        />
        {tasks.length > 0 && (
          <div className="mt-4 max-h-40 overflow-y-auto border rounded p-2 text-sm">
            <ul className="list-disc pl-4 space-y-1">
              {tasks.map((t, i) => (
                <li key={i} className="truncate">
                  {t.name} - {t.schedule}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => importMutation.mutate(tasks)}
            disabled={tasks.length === 0 || importMutation.isPending}
          >
            {importMutation.isPending ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
