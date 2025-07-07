import { useState } from "react";
import { InfoIcon } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export default function AboutModal() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <button
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md"
              aria-label="About PiTasker"
            >
              <InfoIcon className="h-5 w-5" />
            </button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>About PiTasker</TooltipContent>
      </Tooltip>
      <DialogContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <DialogHeader>
          <DialogTitle>About PiTasker</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <div>
            <h3 className="font-medium">Tech Stack</h3>
            <ul className="list-disc pl-4 space-y-1">
              <li>Backend: Node.js, Express.js, TypeScript</li>
              <li>Database: PostgreSQL + Drizzle ORM</li>
              <li>Frontend: React 18, TypeScript, Vite</li>
              <li>Styling: TailwindCSS, Shadcn/ui</li>
              <li>State Management: TanStack Query</li>
              <li>Routing: Wouter</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium">Contact</h3>
            <p>Author: 0xWulf</p>
            <p>
              Email: <a className="text-blue-600 hover:underline" href="mailto:dev@0xwulf.dev">dev@0xwulf.dev</a>
            </p>
          </div>
          <div>
            <h3 className="font-medium">GitHub Repo</h3>
            <a
              href="https://github.com/hexawulf/PiTasker"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              https://github.com/hexawulf/PiTasker
            </a>
          </div>
          <p>
            <strong>Version:</strong> v1.0.0
          </p>
          <p>
            <strong>Release Date:</strong> July 2025
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
