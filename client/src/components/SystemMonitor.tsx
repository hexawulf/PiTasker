import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Activity, Server, Clock } from "lucide-react";

interface MemoryStats {
  current: {
    rss: string;
    heapUsed: string;
    heapTotal: string;
    external: string;
  };
  peak: string;
  uptime: string;
  target: string;
  nodeVersion: string;
}

export default function SystemMonitor() {
  const { data: memoryStats, isLoading } = useQuery<MemoryStats>({
    queryKey: ['/api/memory'],
    refetchInterval: 30000, // Update every 30 seconds
  });

  if (isLoading || !memoryStats) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">System Monitor</CardTitle>
          <Server className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  const isMemoryHigh = parseInt(memoryStats.current.rss) > 75;
  const isMemoryWarning = parseInt(memoryStats.current.rss) > 85;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">System Monitor</CardTitle>
        <Server className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Activity className="h-3 w-3" />
              <span className="text-xs font-medium">Memory Usage</span>
            </div>
            <div className="text-2xl font-bold flex items-center space-x-2">
              <span>{memoryStats.current.rss}</span>
              <Badge 
                variant={isMemoryWarning ? "destructive" : isMemoryHigh ? "secondary" : "default"}
                className="text-xs"
              >
                {memoryStats.target}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Heap: {memoryStats.current.heapUsed} / {memoryStats.current.heapTotal}
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Clock className="h-3 w-3" />
              <span className="text-xs font-medium">System Info</span>
            </div>
            <div className="text-2xl font-bold">{memoryStats.uptime}</div>
            <div className="text-xs text-muted-foreground">
              Peak: {memoryStats.peak} | {memoryStats.nodeVersion}
            </div>
          </div>
        </div>
        
        {isMemoryWarning && (
          <div className="mt-3 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
            ⚠️ Memory usage approaching limit. Consider restarting if performance degrades.
          </div>
        )}
      </CardContent>
    </Card>
  );
}