import { useEffect } from "react";
import { Plus, ListTodo, Moon, Bell } from "lucide-react";
import StatsCards from "@/components/StatsCards";
import TaskForm from "@/components/TaskForm";
import TaskList from "@/components/TaskList";
import QuickActions from "@/components/QuickActions";
import { requestNotificationPermission, setupNotificationListener, showBrowserNotification } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { toast } = useToast();

  useEffect(() => {
    // Request notification permission on component mount
    requestNotificationPermission();

    // Setup notification listener
    setupNotificationListener((payload) => {
      const { title, body } = payload.notification || {};
      if (title && body) {
        showBrowserNotification(title, body);
        toast({
          title,
          description: body,
        });
      }
    });
  }, [toast]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex-shrink-0 flex items-center">
                <ListTodo className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                <h1 className="ml-3 text-xl font-semibold text-gray-900 dark:text-white">PiTasker</h1>
              </div>
              <div className="hidden sm:block">
                <nav className="flex space-x-4">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Task Scheduler & Automation Dashboard</span>
                </nav>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-gray-600 dark:text-gray-300">Connected</span>
              </div>
              <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md">
                <Moon className="h-5 w-5" />
              </button>
              <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full text-xs"></span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Statistics Cards */}
        <StatsCards />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Add Task Form and Quick Actions */}
          <div className="lg:col-span-1 space-y-6">
            <TaskForm />
            <QuickActions />
          </div>

          {/* Task List */}
          <div className="lg:col-span-2">
            <TaskList />
          </div>
        </div>
      </main>
    </div>
  );
}
