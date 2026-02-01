import React, { useState, useEffect } from 'react';
import {
  TruckIcon,
  DocumentTextIcon,
  CurrencyDollarIcon,
  CalendarIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
  MapPinIcon,
  PaperClipIcon,
  BellIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import ShippingNotificationManager from './ShippingNotificationManager';

interface ShippingTask {
  id: string;
  vehicle_id: string;
  task_type: 'truck_transport' | 'boat_container' | 'customs_clearance' | 'unloading' | 'final_delivery' | 'tracking_installation' | 'documentation';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  title: string;
  description?: string;
  responsible_party?: string;
  estimated_cost?: number;
  actual_cost?: number;
  currency: string;
  start_date?: string;
  completion_date?: string;
  due_date?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

interface ShippingTaskManagerProps {
  vehicleId: string;
  isOwner: boolean;
}

const ShippingTaskManager: React.FC<ShippingTaskManagerProps> = ({ vehicleId, isOwner }) => {
  const [tasks, setTasks] = useState<ShippingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTask, setEditingTask] = useState<ShippingTask | null>(null);

  useEffect(() => {
    // loadShippingTasks(); // Temporarily disabled due to RLS recursion issue
  }, [vehicleId]);

  const loadShippingTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('shipping_tasks')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTasks(data || []);
    } catch (error) {
      console.error('Error loading shipping tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTaskIcon = (taskType: string) => {
    switch (taskType) {
      case 'truck_transport': return <TruckIcon className="w-5 h-5" />;
      case 'boat_container': return <MapPinIcon className="w-5 h-5" />;
      case 'customs_clearance': return <DocumentTextIcon className="w-5 h-5" />;
      case 'unloading': return <MapPinIcon className="w-5 h-5" />;
      case 'final_delivery': return <CheckCircleIcon className="w-5 h-5" />;
      case 'tracking_installation': return <PaperClipIcon className="w-5 h-5" />;
      default: return <DocumentTextIcon className="w-5 h-5" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-50';
      case 'in_progress': return 'text-blue-600 bg-blue-50';
      case 'pending': return 'text-yellow-600 bg-yellow-50';
      case 'cancelled': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'text-red-700 bg-red-100';
      case 'high': return 'text-orange-700 bg-orange-100';
      case 'medium': return 'text-yellow-700 bg-yellow-100';
      case 'low': return 'text-green-700 bg-green-100';
      default: return 'text-gray-700 bg-gray-100';
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('shipping_tasks')
        .update({
          status: newStatus,
          completion_date: newStatus === 'completed' ? new Date().toISOString() : null
        })
        .eq('id', taskId);

      if (error) throw error;
      await loadShippingTasks();
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  const ShippingTaskForm: React.FC<{ task?: ShippingTask; onClose: () => void }> = ({ task, onClose }) => {
    const [formData, setFormData] = useState({
      task_type: task?.task_type || 'truck_transport',
      title: task?.title || '',
      description: task?.description || '',
      responsible_party: task?.responsible_party || '',
      estimated_cost: task?.estimated_cost || '',
      actual_cost: task?.actual_cost || '',
      currency: task?.currency || 'USD',
      due_date: task?.due_date ? task.due_date.split('T')[0] : '',
      priority: task?.priority || 'medium',
      notes: task?.notes || '',
      // Additional professional fields stored in metadata
      reference_number: task?.metadata?.reference_number || '',
      tracking_number: task?.metadata?.tracking_number || '',
      contact_name: task?.metadata?.contact_name || '',
      contact_phone: task?.metadata?.contact_phone || '',
      origin_location: task?.metadata?.origin_location || '',
      destination_location: task?.metadata?.destination_location || ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        const taskData = {
          task_type: formData.task_type,
          title: formData.title,
          description: formData.description,
          responsible_party: formData.responsible_party,
          estimated_cost: formData.estimated_cost ? parseFloat(formData.estimated_cost.toString()) : null,
          actual_cost: formData.actual_cost ? parseFloat(formData.actual_cost.toString()) : null,
          currency: formData.currency,
          due_date: formData.due_date ? new Date(formData.due_date).toISOString() : null,
          priority: formData.priority,
          notes: formData.notes,
          vehicle_id: vehicleId,
          metadata: {
            reference_number: formData.reference_number,
            tracking_number: formData.tracking_number,
            contact_name: formData.contact_name,
            contact_phone: formData.contact_phone,
            origin_location: formData.origin_location,
            destination_location: formData.destination_location
          }
        };

        if (task) {
          // Update existing task
          const { error } = await supabase
            .from('shipping_tasks')
            .update(taskData)
            .eq('id', task.id);
          if (error) throw error;
        } else {
          // Create new task
          const { error } = await supabase
            .from('shipping_tasks')
            .insert([taskData]);
          if (error) throw error;
        }

        await loadShippingTasks();
        onClose();
      } catch (error) {
        console.error('Error saving shipping task:', error);
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4">
            {task ? 'Edit Logistics Milestone' : 'Create Logistics Milestone'}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Task Type</label>
              <select
                value={formData.task_type}
                onChange={(e) => setFormData(prev => ({ ...prev, task_type: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="truck_transport">Truck Transport</option>
                <option value="boat_container">Boat Container</option>
                <option value="customs_clearance">Customs Clearance</option>
                <option value="unloading">Unloading</option>
                <option value="final_delivery">Final Delivery</option>
                <option value="tracking_installation">GPS Tracking Installation</option>
                <option value="documentation">Documentation</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Responsible Party</label>
              <input
                type="text"
                value={formData.responsible_party}
                onChange={(e) => setFormData(prev => ({ ...prev, responsible_party: e.target.value }))}
                placeholder="Company or individual responsible"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Origin</label>
                <input
                  type="text"
                  value={formData.origin_location}
                  onChange={(e) => setFormData(prev => ({ ...prev, origin_location: e.target.value }))}
                  placeholder="Starting location"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
                <input
                  type="text"
                  value={formData.destination_location}
                  onChange={(e) => setFormData(prev => ({ ...prev, destination_location: e.target.value }))}
                  placeholder="Final location"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference Number</label>
                <input
                  type="text"
                  value={formData.reference_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, reference_number: e.target.value }))}
                  placeholder="Booking/Container #"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tracking Number</label>
                <input
                  type="text"
                  value={formData.tracking_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, tracking_number: e.target.value }))}
                  placeholder="Tracking ID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                <input
                  type="text"
                  value={formData.contact_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, contact_name: e.target.value }))}
                  placeholder="Point of contact"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Phone</label>
                <input
                  type="tel"
                  value={formData.contact_phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, contact_phone: e.target.value }))}
                  placeholder="Phone number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Cost</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.estimated_cost}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimated_cost: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData(prev => ({ ...prev, currency: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="XCD">XCD (St Barths)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData(prev => ({ ...prev, due_date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                {task ? 'Update Task' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h3 style={{ fontSize: '10pt' }} className="font-semibold">Logistics & Transportation</h3>
          </div>
          {true && ( // Temporarily always show button for testing
            <button
              onClick={() => setShowCreateForm(true)}
              className="button button-primary"
            >
              Add Milestone
            </button>
          )}
        </div>
      </div>

      <div className="card-body">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No logistics milestones defined</p>
            <p className="text-sm">Track transportation, shipping, and delivery milestones</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <div key={task.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <div className="text-blue-600 mt-1">
                      {getTaskIcon(task.task_type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <h4 className="font-medium text-gray-900">{task.title}</h4>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(task.status)}`}>
                          {task.status.replace('_', ' ')}
                        </span>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </span>
                      </div>

                      {task.description && (
                        <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                        {task.responsible_party && (
                          <div className="flex items-center space-x-1">
                            <UserGroupIcon className="w-4 h-4" />
                            <span>{task.responsible_party}</span>
                          </div>
                        )}

                        {task.metadata?.origin_location && task.metadata?.destination_location && (
                          <div className="flex items-center space-x-1">
                            <MapPinIcon className="w-4 h-4" />
                            <span>{task.metadata.origin_location} → {task.metadata.destination_location}</span>
                          </div>
                        )}

                        {task.metadata?.reference_number && (
                          <div className="flex items-center space-x-1">
                            <DocumentTextIcon className="w-4 h-4" />
                            <span>Ref: {task.metadata.reference_number}</span>
                          </div>
                        )}

                        {task.metadata?.tracking_number && (
                          <div className="flex items-center space-x-1">
                            <PaperClipIcon className="w-4 h-4" />
                            <span>Track: {task.metadata.tracking_number}</span>
                          </div>
                        )}

                        {task.due_date && (
                          <div className="flex items-center space-x-1">
                            <CalendarIcon className="w-4 h-4" />
                            <span>Due: {new Date(task.due_date).toLocaleDateString()}</span>
                          </div>
                        )}

                        {(task.estimated_cost || task.actual_cost) && (
                          <div className="flex items-center space-x-1">
                            <CurrencyDollarIcon className="w-4 h-4" />
                            <span>
                              {task.actual_cost ? `${task.currency} ${task.actual_cost}` : `Est: ${task.currency} ${task.estimated_cost || 0}`}
                            </span>
                          </div>
                        )}
                      </div>
                      
                      {/* Notification Manager for this task */}
                      <ShippingNotificationManager
                        taskId={task.id}
                        taskTitle={task.title}
                        isOwner={isOwner}
                      />
                    </div>
                  </div>

                  {isOwner && (
                    <div className="flex items-center space-x-2">
                      {task.status !== 'completed' && task.status !== 'cancelled' && (
                        <select
                          value={task.status}
                          onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                          className="text-sm border border-gray-300 rounded px-2 py-1"
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      )}

                      <button
                        onClick={() => setEditingTask(task)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateForm && (
        <ShippingTaskForm onClose={() => setShowCreateForm(false)} />
      )}

      {editingTask && (
        <ShippingTaskForm task={editingTask} onClose={() => setEditingTask(null)} />
      )}
    </div>
  );
};

export default ShippingTaskManager;
