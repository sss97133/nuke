// Vehicle Project Management Types

export interface ProjectCategory {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  created_at: string;
}

export interface PriorityLevel {
  id: string;
  name: string;
  level: number;
  description?: string;
  color: string;
  created_at: string;
}

export interface TaskStatus {
  id: string;
  name: string;
  description?: string;
  color: string;
  is_completed: boolean;
  created_at: string;
}

export interface VehicleProject {
  id: string;
  vehicle_id: string;
  owner_id: string;
  title: string;
  description?: string;
  category_id?: string;
  priority_id?: string;
  status_id?: string;
  estimated_hours?: number;
  actual_hours: number;
  estimated_cost?: number;
  actual_cost: number;
  target_completion_date?: string;
  started_date?: string;
  completed_date?: string;
  notes?: string;
  is_blocking_other_tasks: boolean;
  blocks_vehicle_operation: boolean;
  requires_professional_help: boolean;
  created_at: string;
  updated_at: string;
  
  // Joined data
  category?: ProjectCategory;
  priority?: PriorityLevel;
  status?: TaskStatus;
  vehicle?: {
    id: string;
    make: string;
    model: string;
    year?: number;
  };
  tasks?: VehicleTask[];
}

export interface VehicleTask {
  id: string;
  project_id?: string;
  vehicle_id: string;
  owner_id: string;
  title: string;
  description?: string;
  category_id?: string;
  priority_id?: string;
  status_id?: string;
  estimated_hours?: number;
  actual_hours: number;
  estimated_cost?: number;
  actual_cost: number;
  target_completion_date?: string;
  started_date?: string;
  completed_date?: string;
  notes?: string;
  is_blocking_other_tasks: boolean;
  blocks_vehicle_operation: boolean;
  requires_professional_help: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
  
  // Joined data
  category?: ProjectCategory;
  priority?: PriorityLevel;
  status?: TaskStatus;
  project?: VehicleProject;
  vehicle?: {
    id: string;
    make: string;
    model: string;
    year?: number;
  };
  parts?: TaskPart[];
  tools?: TaskTool[];
  dependencies?: TaskDependency[];
  time_entries?: TaskTimeEntry[];
}

export interface TaskPart {
  id: string;
  task_id?: string;
  project_id?: string;
  owner_id: string;
  part_name: string;
  part_number?: string;
  brand?: string;
  supplier?: string;
  supplier_url?: string;
  estimated_cost?: number;
  actual_cost?: number;
  quantity_needed: number;
  quantity_ordered: number;
  quantity_received: number;
  order_date?: string;
  expected_delivery_date?: string;
  received_date?: string;
  tracking_number?: string;
  notes?: string;
  is_ordered: boolean;
  is_received: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskTool {
  id: string;
  task_id?: string;
  project_id?: string;
  owner_id: string;
  tool_name: string;
  tool_type?: string;
  brand?: string;
  model?: string;
  is_owned: boolean;
  is_needed: boolean;
  estimated_cost?: number;
  actual_cost?: number;
  purchase_date?: string;
  supplier?: string;
  supplier_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  dependency_type: 'blocks' | 'requires' | 'related';
  created_at: string;
  
  // Joined data
  depends_on_task?: VehicleTask;
}

export interface TaskTimeEntry {
  id: string;
  task_id?: string;
  project_id?: string;
  owner_id: string;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  description?: string;
  created_at: string;
}

// Form types for creating/editing
export interface CreateProjectData {
  vehicle_id: string;
  title: string;
  description?: string;
  category_id?: string;
  priority_id?: string;
  estimated_hours?: number;
  estimated_cost?: number;
  target_completion_date?: string;
  notes?: string;
  is_blocking_other_tasks?: boolean;
  blocks_vehicle_operation?: boolean;
  requires_professional_help?: boolean;
}

export interface CreateTaskData {
  project_id?: string;
  vehicle_id: string;
  title: string;
  description?: string;
  category_id?: string;
  priority_id?: string;
  estimated_hours?: number;
  estimated_cost?: number;
  target_completion_date?: string;
  notes?: string;
  is_blocking_other_tasks?: boolean;
  blocks_vehicle_operation?: boolean;
  requires_professional_help?: boolean;
  order_index?: number;
}

export interface CreatePartData {
  task_id?: string;
  project_id?: string;
  part_name: string;
  part_number?: string;
  brand?: string;
  supplier?: string;
  supplier_url?: string;
  estimated_cost?: number;
  quantity_needed?: number;
  notes?: string;
}

export interface CreateToolData {
  task_id?: string;
  project_id?: string;
  tool_name: string;
  tool_type?: string;
  brand?: string;
  model?: string;
  is_owned?: boolean;
  estimated_cost?: number;
  supplier?: string;
  supplier_url?: string;
  notes?: string;
}

// View/filter types
export interface TaskFilter {
  vehicle_id?: string;
  category_id?: string;
  priority_id?: string;
  status_id?: string;
  is_blocking?: boolean;
  blocks_vehicle_operation?: boolean;
  requires_professional_help?: boolean;
  has_pending_parts?: boolean;
  has_pending_tools?: boolean;
  target_date_before?: string;
  target_date_after?: string;
}

export interface TaskSort {
  field: 'priority' | 'target_completion_date' | 'created_at' | 'updated_at' | 'title' | 'estimated_hours' | 'estimated_cost';
  direction: 'asc' | 'desc';
}

// Dashboard/summary types
export interface ProjectSummary {
  total_projects: number;
  total_tasks: number;
  completed_projects: number;
  completed_tasks: number;
  total_estimated_cost: number;
  total_actual_cost: number;
  total_estimated_hours: number;
  total_actual_hours: number;
  pending_parts_count: number;
  pending_tools_count: number;
  blocking_tasks_count: number;
  overdue_tasks_count: number;
}

export interface VehicleSummary {
  vehicle_id: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year?: number;
  total_projects: number;
  total_tasks: number;
  completed_projects: number;
  completed_tasks: number;
  total_estimated_cost: number;
  total_actual_cost: number;
  pending_parts_count: number;
  blocking_tasks_count: number;
  overdue_tasks_count: number;
  highest_priority_level: number;
}

export interface DailyTaskList {
  critical_tasks: VehicleTask[];
  high_priority_tasks: VehicleTask[];
  waiting_for_parts: VehicleTask[];
  waiting_for_tools: VehicleTask[];
  quick_tasks: VehicleTask[]; // Tasks under 1 hour
  fill_in_tasks: VehicleTask[]; // Low priority tasks for spare time
}
