import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";
import type { Task } from "@shared/schema";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  task: Task | null;
  action: 'run' | 'delete';
  isLoading?: boolean;
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  task,
  action,
  isLoading = false
}: ConfirmationModalProps) {
  if (!task) return null;

  const actionText = action === 'run' ? 'Run' : 'Delete';
  const actionDescription = action === 'run' 
    ? `Are you sure you want to run the task "${task.name}"?`
    : `Are you sure you want to delete the task "${task.name}"? This action cannot be undone.`;

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        <AlertDialogHeader>
          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 dark:bg-red-900 rounded-full mb-4">
            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <AlertDialogTitle className="text-center text-gray-900 dark:text-white">
            Confirm Task {actionText}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center text-gray-500 dark:text-gray-400">
            {actionDescription}
          </AlertDialogDescription>
          {action === 'run' && (
            <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-700 rounded-md">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Command: <code className="font-mono text-xs">{task.command}</code>
              </p>
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="flex gap-2 justify-center">
          <AlertDialogCancel 
            onClick={onClose}
            className="bg-gray-300 dark:bg-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-400 dark:hover:bg-gray-500"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className={`${
              action === 'delete' 
                ? 'bg-red-600 hover:bg-red-700' 
                : 'bg-blue-600 hover:bg-blue-700'
            } text-white`}
          >
            {isLoading ? `${actionText}ing...` : `${actionText} Task`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
