import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, CheckCircle2, AlertCircle, RefreshCw, Download } from "lucide-react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CronJob {
  name: string;
  schedule: string;
  command: string;
}

export default function ImportCronModal() {
  const [open, setOpen] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/crontab/import");
      return res.json();
    },
    onSuccess: (data: { imported: number; updated: number; skipped: number; errors: string[] }) => {
      toast({
        title: "Import Complete",
        description: `${data.imported} new tasks imported, ${data.updated} updated, ${data.skipped} skipped`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/stats"] });
      setOpen(false);
      setSelectedIndices(new Set());
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to import from crontab",
        variant: "destructive",
      });
    },
  });

  const handleSelectAll = () => {
    if (selectedIndices.size === (crontabData?.content?.split('\n').filter((line: string) => line.trim() && !line.trim().startsWith('#')).length || 0)) {
      setSelectedIndices(new Set());
    } else {
      const allIndices = new Set<number>();
      crontabData?.content?.split('\n').forEach((line: string, index: number) => {
        if (line.trim() && !line.trim().startsWith('#')) {
          allIndices.add(index);
        }
      });
      setSelectedIndices(allIndices);
    }
  };

  const toggleSelection = (index: number) => {
    const newSelection = new Set(selectedIndices);
    if (newSelection.has(index)) {
      newSelection.delete(index);
    } else {
      newSelection.add(index);
    }
    setSelectedIndices(newSelection);
  };

  // Fetch raw crontab when modal opens
  const { data: crontabData, isLoading: isLoadingCrontab, refetch } = useQuery<{ content: string }>({
    queryKey: ["/api/crontab/raw"],
    queryFn: getQueryFn<{ content: string }>({ on401: "returnNull" }),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      refetch();
      setSelectedIndices(new Set());
    }
  }, [open, refetch]);

  const parsedEntries = crontabData?.content?.split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !line.startsWith('#')) || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center space-x-2 bg-white hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600"
        >
          <Upload className="h-4 w-4" />
          <span>Import from Crontab</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Download className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <span>Import from System Crontab</span>
          </DialogTitle>
          <DialogDescription>
            Import existing crontab entries into PiTasker. Entries already managed by PiTasker will be updated.
          </DialogDescription>
        </DialogHeader>

        {isLoadingCrontab ? (
          <div className="py-8 text-center">
            <RefreshCw className="h-8 w-8 mx-auto animate-spin text-blue-600 dark:text-blue-400" />
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading crontab...</p>
          </div>
        ) : (
          <>
            {parsedEntries.length === 0 ? (
              <Alert className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-800">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                <AlertDescription className="text-gray-900 dark:text-white">
                  No crontab entries found. Your system crontab is empty or contains only comments.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        {parsedEntries.length} entries found
                      </Badge>
                      <Badge variant="outline" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {selectedIndices.size} selected
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAll}
                    >
                      {selectedIndices.size === parsedEntries.length ? "Deselect All" : "Select All"}
                    </Button>
                  </div>

                  <Alert className="bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-800">
                    <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <AlertDescription className="text-sm text-gray-700 dark:text-gray-300">
                      Importing will create new tasks in PiTasker and sync them with your system crontab. 
                      Existing PiTasker-managed entries will be updated automatically.
                    </AlertDescription>
                  </Alert>

                  <ScrollArea className="h-[300px] rounded-md border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900">
                    <div className="space-y-2">
                      {parsedEntries.map(({ line, index }) => {
                        const parts = line.split(/\s+/);
                        const schedule = parts.slice(0, 5).join(' ');
                        const command = parts.slice(5).join(' ');
                        
                        return (
                          <div
                            key={index}
                            className="flex items-start space-x-3 p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
                          >
                            <Checkbox
                              checked={selectedIndices.has(index)}
                              onCheckedChange={() => toggleSelection(index)}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-xs text-gray-600 dark:text-gray-400 mb-1">
                                {schedule}
                              </div>
                              <div className="font-mono text-sm text-gray-900 dark:text-white break-all">
                                {command}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </>
        )}

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => refetch()}
            variant="outline"
            disabled={isLoadingCrontab}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingCrontab ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={parsedEntries.length === 0 || importMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Download className="mr-2 h-4 w-4" />
            {importMutation.isPending ? "Importing..." : "Import All"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
