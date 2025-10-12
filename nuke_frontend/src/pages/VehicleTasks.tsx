import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year?: number;
  color?: string;
  mileage?: number;
}

interface Task {
  id: string;
  vehicle_id: string;
  title: string;
  description?: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low' | 'Someday';
  status: 'Not Started' | 'In Progress' | 'Waiting for Parts' | 'Waiting for Tools' | 'Completed';
  category: string;
  estimated_cost?: number;
  target_date?: string;
  is_blocking: boolean;
  blocks_vehicle_operation: boolean;
  notes?: string;
  created_at: string;
}

const VehicleTasks: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddTask, setShowAddTask] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'active' | 'completed'>('active');

  // New task form state
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'Medium' as Task['priority'],
    status: 'Not Started' as Task['status'],
    category: 'Maintenance',
    estimated_cost: '',
    target_date: '',
    is_blocking: false,
    blocks_vehicle_operation: false,
    notes: ''
  });

  useEffect(() => {
    if (vehicleId) {
      initializeData();
    }
  }, [vehicleId]);

  const initializeData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setUser(session?.user || null);
    
    if (vehicleId) {
      await Promise.all([
        loadVehicle(vehicleId, session?.user?.id),
        loadTasks(vehicleId, session?.user?.id)
      ]);
    }
    
    setLoading(false);
  };

  const loadVehicle = async (vId: string, userId?: string) => {
    try {
      // Try to load from database first
      if (userId) {
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, make, model, year, color, mileage')
          .eq('id', vId)
          .eq('user_id', userId)
          .single();

        if (!error && data) {
          setVehicle(data);
          return;
        }
      }

      // Fallback to localStorage
      const localVehicles = JSON.parse(localStorage.getItem('anonymousVehicles') || '[]');
      const localVehicle = localVehicles.find((v: any) => v.id === vId);
      if (localVehicle) {
        setVehicle(localVehicle);
      }
    } catch (error) {
      console.error('Error loading vehicle:', error);
    }
  };

  const loadTasks = async (vId: string, userId?: string) => {
    try {
      // Load tasks from localStorage (temporary storage)
      const userKey = userId || 'anonymous';
      const storedTasks = localStorage.getItem(`vehicle_tasks_${userKey}_${vId}`);
      if (storedTasks) {
        setTasks(JSON.parse(storedTasks));
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
    }
  };

  const saveTasks = (updatedTasks: Task[]) => {
    if (vehicleId) {
      const userKey = user?.id || 'anonymous';
      localStorage.setItem(`vehicle_tasks_${userKey}_${vehicleId}`, JSON.stringify(updatedTasks));
      setTasks(updatedTasks);
    }
  };

  const addTask = () => {
    if (!vehicleId || !newTask.title) return;

    const task: Task = {
      id: Date.now().toString(),
      vehicle_id: vehicleId,
      title: newTask.title,
      description: newTask.description,
      priority: newTask.priority,
      status: newTask.status,
      category: newTask.category,
      estimated_cost: newTask.estimated_cost ? parseFloat(newTask.estimated_cost) : undefined,
      target_date: newTask.target_date || undefined,
      is_blocking: newTask.is_blocking,
      blocks_vehicle_operation: newTask.blocks_vehicle_operation,
      notes: newTask.notes,
      created_at: new Date().toISOString()
    };

    const updatedTasks = [...tasks, task];
    saveTasks(updatedTasks);

    // Reset form
    setNewTask({
      title: '',
      description: '',
      priority: 'Medium',
      status: 'Not Started',
      category: 'Maintenance',
      estimated_cost: '',
      target_date: '',
      is_blocking: false,
      blocks_vehicle_operation: false,
      notes: ''
    });
    setShowAddTask(false);
  };

  const updateTaskStatus = (taskId: string, status: Task['status']) => {
    const updatedTasks = tasks.map(task =>
      task.id === taskId ? { ...task, status } : task
    );
    saveTasks(updatedTasks);
  };

  const deleteTask = (taskId: string) => {
    const updatedTasks = tasks.filter(task => task.id !== taskId);
    saveTasks(updatedTasks);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Critical': return '#DC2626';
      case 'High': return '#EA580C';
      case 'Medium': return '#D97706';
      case 'Low': return '#65A30D';
      case 'Someday': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Not Started': return '#6B7280';
      case 'In Progress': return '#3B82F6';
      case 'Waiting for Parts': return '#F59E0B';
      case 'Waiting for Tools': return '#8B5CF6';
      case 'Completed': return '#10B981';
      default: return '#6B7280';
    }
  };

  const isOverdue = (task: Task) => {
    return task.target_date && 
           new Date(task.target_date) < new Date() &&
           task.status !== 'Completed';
  };

  const getFilteredTasks = () => {
    switch (viewMode) {
      case 'active':
        return tasks.filter(t => t.status !== 'Completed');
      case 'completed':
        return tasks.filter(t => t.status === 'Completed');
      default:
        return tasks;
    }
  };

  const renderTaskCard = (task: Task) => (
    <div key={task.id} 
         className={`border-l-4 p-4 mb-3 bg-white rounded-r-lg shadow-sm hover:shadow-md transition-shadow ${
           isOverdue(task) ? 'border-red-500 bg-red-50' : ''
         }`}
         style={{ borderLeftColor: getPriorityColor(task.priority) }}>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-gray-900">{task.title}</h3>
            {task.is_blocking && (
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
            <span style={{ color: getPriorityColor(task.priority) }}>{task.priority}</span>
            <span style={{ color: getStatusColor(task.status) }}>{task.status}</span>
            <span className="px-2 py-1 text-xs bg-gray-100 rounded">{task.category}</span>
          </div>
          
          {task.description && (
            <p className="text-sm text-gray-700 mb-2">{task.description}</p>
          )}
          
          <div className="flex items-center gap-4 text-xs text-gray-500">
            {task.estimated_cost && (
              <span>Cost: ${task.estimated_cost}</span>
            )}
            {task.target_date && (
              <span>Due: {new Date(task.target_date).toLocaleDateString()}</span>
            )}
          </div>
          
          {task.notes && (
            <p className="text-xs text-gray-600 mt-2 italic">{task.notes}</p>
          )}
        </div>
        
        <div className="flex flex-col gap-2 ml-4">
          <select
            value={task.status}
            onChange={(e) => updateTaskStatus(task.id, e.target.value as Task['status'])}
            className="text-xs border rounded px-2 py-1"
          >
            <option value="Not Started">Not Started</option>
            <option value="In Progress">In Progress</option>
            <option value="Waiting for Parts">Waiting for Parts</option>
            <option value="Waiting for Tools">Waiting for Tools</option>
            <option value="Completed">Completed</option>
          </select>
          <button 
            onClick={() => deleteTask(task.id)}
            className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading vehicle tasks...</p>
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Vehicle Not Found</h1>
          <p className="text-gray-600 mb-4">The vehicle you're looking for doesn't exist.</p>
          <Link to="/local-vehicles" className="button button-primary">
            Back to Vehicles
          </Link>
        </div>
      </div>
    );
  }

  const filteredTasks = getFilteredTasks();
  const activeTasks = tasks.filter(t => t.status !== 'Completed');
  const criticalTasks = activeTasks.filter(t => t.priority === 'Critical');
  const blockingTasks = activeTasks.filter(t => t.is_blocking || t.blocks_vehicle_operation);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header - Vehicle Manila Folder */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Link to="/local-vehicles" className="text-blue-600 hover:text-blue-800">
              ← Back to Vehicles
            </Link>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  📁 {vehicle.year} {vehicle.make} {vehicle.model}
                </h1>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  {vehicle.color && <span>Color: {vehicle.color}</span>}
                  {vehicle.mileage && <span>Mileage: {vehicle.mileage.toLocaleString()} mi</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-600">{activeTasks.length}</div>
                <div className="text-sm text-gray-600">Active Tasks</div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-blue-600">{tasks.length}</div>
            <div className="text-sm text-gray-600">Total Tasks</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-red-600">{criticalTasks.length}</div>
            <div className="text-sm text-gray-600">Critical Tasks</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-orange-600">{blockingTasks.length}</div>
            <div className="text-sm text-gray-600">Blocking Tasks</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-2xl font-bold text-green-600">
              ${tasks.reduce((sum, t) => sum + (t.estimated_cost || 0), 0).toFixed(0)}
            </div>
            <div className="text-sm text-gray-600">Est. Total Cost</div>
          </div>
        </div>

        {/* View Mode Selector */}
        <div className="mb-6">
          <div className="flex gap-2 bg-white p-1 rounded-lg shadow-sm">
            {[
              { key: 'active', label: 'Active Tasks', count: activeTasks.length },
              { key: 'all', label: 'All Tasks', count: tasks.length },
              { key: 'completed', label: 'Completed', count: tasks.filter(t => t.status === 'Completed').length }
            ].map(mode => (
              <button
                key={mode.key}
                onClick={() => setViewMode(mode.key as any)}
                className={`flex-1 px-4 py-3 text-sm font-medium rounded-md transition-colors ${
                  viewMode === mode.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {mode.label} ({mode.count})
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mb-6 flex gap-3">
          <button 
            onClick={() => setShowAddTask(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            + Add Task
          </button>
          <Link 
            to={`/vehicle/${vehicle.id}`}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium"
          >
            View Vehicle Details
          </Link>
        </div>

        {/* Add Task Form */}
        {showAddTask && (
          <div className="bg-white p-6 rounded-lg shadow-sm mb-6">
            <h3 className="text-lg font-semibold mb-4">Add New Task for {vehicle.year} {vehicle.make} {vehicle.model}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Task Title</label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                  placeholder="e.g., Replace brake pads"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={newTask.priority}
                  onChange={(e) => setNewTask({...newTask, priority: e.target.value as Task['priority']})}
                  className="w-full border rounded-md px-3 py-2"
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                  <option value="Someday">Someday</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={newTask.category}
                  onChange={(e) => setNewTask({...newTask, category: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                >
                  <option value="Engine">Engine</option>
                  <option value="Transmission">Transmission</option>
                  <option value="Suspension">Suspension</option>
                  <option value="Brakes">Brakes</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Body">Body</option>
                  <option value="Interior">Interior</option>
                  <option value="Wheels/Tires">Wheels/Tires</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Parts/Ordering">Parts/Ordering</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Cost</label>
                <input
                  type="number"
                  value={newTask.estimated_cost}
                  onChange={(e) => setNewTask({...newTask, estimated_cost: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
                <input
                  type="date"
                  value={newTask.target_date}
                  onChange={(e) => setNewTask({...newTask, target_date: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={newTask.description}
                  onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                  rows={2}
                  placeholder="Additional details..."
                />
              </div>
              <div className="md:col-span-2 flex gap-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={newTask.is_blocking}
                    onChange={(e) => setNewTask({...newTask, is_blocking: e.target.checked})}
                    className="mr-2"
                  />
                  This task is blocking other work
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={newTask.blocks_vehicle_operation}
                    onChange={(e) => setNewTask({...newTask, blocks_vehicle_operation: e.target.checked})}
                    className="mr-2"
                  />
                  This prevents driving the vehicle
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={addTask}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Add Task
              </button>
              <button
                onClick={() => setShowAddTask(false)}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tasks List */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          {filteredTasks.length > 0 ? (
            <div className="space-y-2">
              {filteredTasks
                .sort((a, b) => {
                  const priorityOrder = { 'Critical': 1, 'High': 2, 'Medium': 3, 'Low': 4, 'Someday': 5 };
                  return priorityOrder[a.priority] - priorityOrder[b.priority];
                })
                .map(task => renderTaskCard(task))}
            </div>
          ) : (
            <div className="text-center py-12">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {viewMode === 'completed' ? 'No completed tasks yet' : 'No active tasks'}
              </h3>
              <p className="text-gray-600 mb-4">
                {viewMode === 'completed' 
                  ? 'Complete some tasks to see them here.' 
                  : 'Add your first task for this vehicle to get organized!'
                }
              </p>
              {viewMode !== 'completed' && (
                <button 
                  onClick={() => setShowAddTask(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Add Your First Task
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VehicleTasks;
