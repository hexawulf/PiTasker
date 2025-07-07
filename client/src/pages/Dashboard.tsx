import { useEffect } from "react";
import { Plus, ListTodo, Moon, Bell, User, LogOut, KeyRound } from "lucide-react"; // Added User, LogOut, KeyRound
import { useLocation, Link } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"; // Added DropdownMenu components
import { Button } from "@/components/ui/button"; // Added Button for DropdownMenuTrigger
import StatsCards from "@/components/StatsCards";
import TaskForm from "@/components/TaskForm";
import TaskList from "@/components/TaskList";
import QuickActions from "@/components/QuickActions";
import ImportCronModal from "@/components/ImportCronModal";
import SystemMonitor from "@/components/SystemMonitor";
import AboutModal from "@/components/AboutModal";
import { requestNotificationPermission, setupNotificationListener, showTaskNotification } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useTasks } from "@/hooks/useTasks";

export default function Dashboard() {
  const { toast } = useToast();
  const { data: tasks } = useTasks();
  const [, navigate] = useLocation();
  navigate("/dashboard");


  const handleLogout = async () => {
    try {
      const response = await fetch('/logout', { method: 'GET' });
      const data = await response.json();
      if (response.ok) {
        localStorage.removeItem('isAuthenticated'); // Clear auth flag
        toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
        navigate(data.redirectTo || '/login');
      } else {
        toast({ title: 'Logout Failed', description: data.message || 'Could not log out.', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Logout request failed.', variant: 'destructive' });
    }
  };

  useEffect(() => {
    // Request notification permission on component mount
    requestNotificationPermission();

    // Setup notification listener
    setupNotificationListener((payload) => {
      const { title, body } = payload.notification || {};
      if (title && body) {
        showTaskNotification(title, 'success');
        toast({
          title,
          description: body,
        });
      }
    });
  }, [toast]);

  // Monitor task status changes for notifications
  useEffect(() => {
    if (tasks) {
      const completedTasks = tasks.filter(task => 
        (task.status === 'success' || task.status === 'failed') && 
        task.lastRun && 
        new Date(task.lastRun).getTime() > Date.now() - 10000 // Last 10 seconds
      );

      completedTasks.forEach(task => {
        const timestamp = task.lastRun ? new Date(task.lastRun).toISOString() : undefined;
        showTaskNotification(task.name, task.status as 'success' | 'failed', timestamp);
        toast({
          title: `Task ${task.status === 'success' ? 'Completed' : 'Failed'}`,
          description: `"${task.name}" ${task.status === 'success' ? 'completed successfully' : 'failed to execute'}`,
          variant: task.status === 'success' ? 'default' : 'destructive',
        });
      });
    }
  }, [tasks, toast]);

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
                <AboutModal />
                <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md">
                  <Moon className="h-5 w-5" />
                </button>
              <button className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full text-xs"></span>
              </button>

              {/* User Dropdown Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full p-0 hover:bg-gray-200 dark:hover:bg-gray-700">
                    <User className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-lg" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal text-gray-900 dark:text-white">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">Admin</p> {/* Username can be dynamic later */}
                      <p className="text-xs leading-none text-gray-500 dark:text-gray-400">admin@example.com</p> {/* Email can be dynamic or removed */}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                  <DropdownMenuItem className="text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer" onSelect={() => navigate('/change-password')}>
                    <KeyRound className="mr-2 h-4 w-4" />
                    <span>Change Password</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700"/>
                  <DropdownMenuItem className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer focus:bg-red-100 dark:focus:bg-red-800" onSelect={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
            <ImportCronModal />
            <SystemMonitor />
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
