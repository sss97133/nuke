import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { ProjectManagementService } from '../services/projectManagementService';
import type {
  VehicleTask,
  VehicleProject,
  ProjectCategory,
  PriorityLevel,
  TaskStatus,
  TaskFilter,
  DailyTaskList,
  VehicleSummary
} from '../types/projectManagement';

// Simple auth hook to work with existing session-based auth
const useAuth = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );
    
    return () => subscription.unsubscribe();
  }, []);
  
  return { user, loading };
};

interface ProjectManagementProps {}

const ProjectManagement: React.FC<ProjectManagementProps> = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Data state
  const [tasks, setTasks] = useState<VehicleTask[]>([]);
  const [projects, setProjects] = useState<VehicleProject[]>([]);
  const [dailyTaskList, setDailyTaskList] = useState<DailyTaskList | null>(null);
  const [vehicleSummaries, setVehicleSummaries] = useState<VehicleSummary[]>([]);
  
  // Reference data
  const [categories, setCategories] = useState<ProjectCategory[]>([]);
  const [priorities, setPriorities] = useState<PriorityLevel[]>([]);
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  
  // Filter and view state
  const [activeFilter, setActiveFilter] = useState<TaskFilter>({});
  const [viewMode, setViewMode] = useState<'daily' | 'all' | 'by-vehicle' | 'by-priority'>('daily');
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user?.id]);

  const loadData = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Load reference data
      const [categoriesData, prioritiesData, statusesData] = await Promise.all([
        ProjectManagementService.getProjectCategories(),
        ProjectManagementService.getPriorityLevels(),
        ProjectManagementService.getTaskStatuses()
      ]);
      
      setCategories(categoriesData);
      setPriorities(prioritiesData);
      setStatuses(statusesData);
      
      // Load user data
      const [tasksData, projectsData, dailyData, vehicleData] = await Promise.all([
        ProjectManagementService.getTasks(user.id),
        ProjectManagementService.getProjects(user.id),
        ProjectManagementService.getDailyTaskList(user.id),
        ProjectManagementService.getVehicleSummaries(user.id)
      ]);
      
      setTasks(tasksData);
      setProjects(projectsData);
      setDailyTaskList(dailyData);
      setVehicleSummaries(vehicleData);
      
    } catch (err) {
      console.error('Error loading project management data:', err);
      setError('Failed to load project data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priorityLevel?: number) => {
    if (!priorityLevel) return '#6B7280';
    switch (priorityLevel) {
      case 1: return '#DC2626'; // Critical - Red
      case 2: return '#EA580C'; // High - Orange
      case 3: return '#D97706'; // Medium - Amber
      case 4: return '#65A30D'; // Low - Green
      case 5: return '#6B7280'; // Someday - Gray
      default: return '#6B7280';
    }
  };

  const getStatusColor = (status?: TaskStatus) => {
    return status?.color || '#6B7280';
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString();
  };

  const isOverdue = (task: VehicleTask) => {
    return task.target_completion_date && 
           new Date(task.target_completion_date) < new Date() &&
           !task.status?.is_completed;
  };

  const renderTaskRow = (task: VehicleTask, showVehicle = true) => (
    <div key={task.id} className={`border-l-4 p-4 mb-3 bg-white rounded-r-lg shadow-sm hover:shadow-md transition-shadow ${isOverdue(task) ? 'border-red-500 bg-red-50' : ''}`}
         style={{ borderLeftColor: getPriorityColor(task.priority?.level) }}>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-gray-900">{task.title}</h3>
            {task.is_blocking_other_tasks && (
              <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">BLOCKING</span>
            )}
            {task.blocks_vehicle_operation && (
              <span className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded-full">BLOCKS VEHICLE</span>
            )}
            {isOverdue(task) && (
              <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">OVERDUE</span>
            )}
          </div>
          
          <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
            {showVehicle && task.vehicle && (
              <span className="font-medium">
                {task.vehicle.year} {task.vehicle.make} {task.vehicle.model}
              </span>
            )}
            <span style={{ color: getPriorityColor(task.priority?.level) }}>
              {task.priority?.name || 'No Priority'}
            </span>
            <span style={{ color: getStatusColor(task.status) }}>
              {task.status?.name || 'No Status'}
            </span>
            {task.category && (
              <span className="px-2 py-1 text-xs bg-gray-100 rounded">
                {task.category.name}
              </span>
            )}
          </div>
          
          {task.description && (
            <p className="text-sm text-gray-700 mb-2">{task.description}</p>
          )}
          
          <div className="flex items-center gap-4 text-xs text-gray-500">
            {task.estimated_hours && (
              <span>Est: {task.estimated_hours}h</span>
            )}
            {task.estimated_cost && (
              <span>Cost: {formatCurrency(task.estimated_cost)}</span>
            )}
            {task.target_completion_date && (
              <span>Due: {formatDate(task.target_completion_date)}</span>
            )}
          </div>
        </div>
        
        <div className="flex gap-2 ml-4">
          <button className="px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200">
            Edit
          </button>
          <button className="px-3 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200">
            Start
          </button>
        </div>
      </div>
    </div>
  );

  const renderDailyView = () => {
    if (!dailyTaskList) return null;

    return (
      <div className="space-y-6">
        {/* Critical Tasks */}
        {dailyTaskList.critical_tasks.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-red-600 mb-3 flex items-center gap-2">
              CRITICAL TASKS ({dailyTaskList.critical_tasks.length})
            </h2>
            <div className="space-y-2">
              {dailyTaskList.critical_tasks.map(task => renderTaskRow(task))}
            </div>
          </div>
        )}

        {/* High Priority Tasks */}
        {dailyTaskList.high_priority_tasks.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-orange-600 mb-3 flex items-center gap-2">
              HIGH PRIORITY ({dailyTaskList.high_priority_tasks.length})
            </h2>
            <div className="space-y-2">
              {dailyTaskList.high_priority_tasks.map(task => renderTaskRow(task))}
            </div>
          </div>
        )}

        {/* Waiting for Parts */}
        {dailyTaskList.waiting_for_parts.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-yellow-600 mb-3 flex items-center gap-2">
              📦 WAITING FOR PARTS ({dailyTaskList.waiting_for_parts.length})
            </h2>
            <div className="space-y-2">
              {dailyTaskList.waiting_for_parts.map(task => renderTaskRow(task))}
            </div>
          </div>
        )}

        {/* Waiting for Tools */}
        {dailyTaskList.waiting_for_tools.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-purple-600 mb-3 flex items-center gap-2">
              WAITING FOR TOOLS ({dailyTaskList.waiting_for_tools.length})
            </h2>
            <div className="space-y-2">
              {dailyTaskList.waiting_for_tools.map(task => renderTaskRow(task))}
            </div>
          </div>
        )}

        {/* Quick Tasks (Fill-in work) */}
        {dailyTaskList.quick_tasks.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-green-600 mb-3 flex items-center gap-2">
              QUICK TASKS (&lt;1hr) ({dailyTaskList.quick_tasks.length})
            </h2>
            <div className="space-y-2">
              {dailyTaskList.quick_tasks.map(task => renderTaskRow(task))}
            </div>
          </div>
        )}

        {/* Fill-in Tasks */}
        {dailyTaskList.fill_in_tasks.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-gray-600 mb-3 flex items-center gap-2">
              🕒 FILL-IN TASKS ({dailyTaskList.fill_in_tasks.length})
            </h2>
            <div className="space-y-2">
              {dailyTaskList.fill_in_tasks.map(task => renderTaskRow(task))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderByVehicleView = () => {
    const vehicleGroups = tasks.reduce((groups: Record<string, VehicleTask[]>, task: VehicleTask) => {
      const vehicleKey = `${task.vehicle?.year || ''} ${task.vehicle?.make || ''} ${task.vehicle?.model || ''}`.trim();
      if (!groups[vehicleKey]) {
        groups[vehicleKey] = [];
      }
      groups[vehicleKey].push(task);
      return groups;
    }, {} as Record<string, VehicleTask[]>);

    return (
      <div className="space-y-6">
        {Object.entries(vehicleGroups).map(([vehicleName, vehicleTasks]: [string, VehicleTask[]]) => (
          <div key={vehicleName}>
            <h2 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
              🚗 {vehicleName} ({vehicleTasks.length} tasks)
            </h2>
            <div className="space-y-2">
              {vehicleTasks
                .sort((a: VehicleTask, b: VehicleTask) => (a.priority?.level || 5) - (b.priority?.level || 5))
                .map((task: VehicleTask) => renderTaskRow(task, false))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderAllTasksView = () => {
    const sortedTasks = [...tasks].sort((a, b) => {
      // Sort by priority first, then by target date
      const priorityDiff = (a.priority?.level || 5) - (b.priority?.level || 5);
      if (priorityDiff !== 0) return priorityDiff;
      
      if (!a.target_completion_date && !b.target_completion_date) return 0;
      if (!a.target_completion_date) return 1;
      if (!b.target_completion_date) return -1;
      
      return new Date(a.target_completion_date).getTime() - new Date(b.target_completion_date).getTime();
    });

    return (
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-gray-800 mb-3">
          All Tasks ({tasks.length})
        </h2>
        {sortedTasks.map(task => renderTaskRow(task))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your project data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={loadData}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Vehicle Project Management</h1>
          <p className="text-gray-600">Organize and prioritize all your vehicle projects and tasks</p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-blue-600">{tasks.length}</div>
            <div className="text-sm text-gray-600">Total Tasks</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-red-600">
              {tasks.filter(t => t.priority?.level === 1).length}
            </div>
            <div className="text-sm text-gray-600">Critical Tasks</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-orange-600">
              {tasks.filter(t => t.is_blocking_other_tasks).length}
            </div>
            <div className="text-sm text-gray-600">Blocking Tasks</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-green-600">{vehicleSummaries.length}</div>
            <div className="text-sm text-gray-600">Vehicles</div>
          </div>
        </div>

        {/* View Mode Selector */}
        <div className="mb-6">
          <div className="flex gap-2 bg-white p-1 rounded-lg shadow-sm">
            {[
              { key: 'daily', label: 'Daily Focus', desc: 'Prioritized daily task list' },
              { key: 'all', label: 'All Tasks', desc: 'Complete task list' },
              { key: 'by-vehicle', label: 'By Vehicle', desc: 'Grouped by vehicle' },
              { key: 'by-priority', label: 'By Priority', desc: 'Grouped by priority' }
            ].map(mode => (
              <button
                key={mode.key}
                onClick={() => setViewMode(mode.key as any)}
                className={`flex-1 px-4 py-3 text-sm font-medium rounded-md transition-colors ${
                  viewMode === mode.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                title={mode.desc}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mb-6 flex gap-3">
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
            + Add Task
          </button>
          <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">
            + Add Project
          </button>
          <button className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium">
            Reports
          </button>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          {viewMode === 'daily' && renderDailyView()}
          {viewMode === 'all' && renderAllTasksView()}
          {viewMode === 'by-vehicle' && renderByVehicleView()}
          {viewMode === 'by-priority' && renderAllTasksView()}
        </div>
      </div>
    </div>
  );
};

export default ProjectManagement;
