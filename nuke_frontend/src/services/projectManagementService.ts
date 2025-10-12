import { supabase } from '../lib/supabase';
import type {
  VehicleProject,
  VehicleTask,
  TaskPart,
  TaskTool,
  TaskDependency,
  TaskTimeEntry,
  ProjectCategory,
  PriorityLevel,
  TaskStatus,
  CreateProjectData,
  CreateTaskData,
  CreatePartData,
  CreateToolData,
  TaskFilter,
  TaskSort,
  ProjectSummary,
  VehicleSummary,
  DailyTaskList
} from '../types/projectManagement';

export class ProjectManagementService {
  // Reference data methods
  static async getProjectCategories(): Promise<ProjectCategory[]> {
    const { data, error } = await supabase
      .from('project_categories')
      .select('*')
      .order('name');
    
    if (error) throw error;
    return data || [];
  }

  static async getPriorityLevels(): Promise<PriorityLevel[]> {
    const { data, error } = await supabase
      .from('priority_levels')
      .select('*')
      .order('level');
    
    if (error) throw error;
    return data || [];
  }

  static async getTaskStatuses(): Promise<TaskStatus[]> {
    const { data, error } = await supabase
      .from('task_statuses')
      .select('*')
      .order('name');
    
    if (error) throw error;
    return data || [];
  }

  // Project methods
  static async getProjects(userId: string): Promise<VehicleProject[]> {
    const { data, error } = await supabase
      .from('vehicle_projects')
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        vehicle:vehicles(id, make, model, year)
      `)
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  static async getProjectById(projectId: string): Promise<VehicleProject | null> {
    const { data, error } = await supabase
      .from('vehicle_projects')
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        vehicle:vehicles(id, make, model, year),
        tasks:vehicle_tasks(
          *,
          category:project_categories(*),
          priority:priority_levels(*),
          status:task_statuses(*)
        )
      `)
      .eq('id', projectId)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async createProject(projectData: CreateProjectData): Promise<VehicleProject> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('vehicle_projects')
      .insert({
        ...projectData,
        owner_id: user.user.id
      })
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        vehicle:vehicles(id, make, model, year)
      `)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async updateProject(projectId: string, updates: Partial<CreateProjectData>): Promise<VehicleProject> {
    const { data, error } = await supabase
      .from('vehicle_projects')
      .update(updates)
      .eq('id', projectId)
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        vehicle:vehicles(id, make, model, year)
      `)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async deleteProject(projectId: string): Promise<void> {
    const { error } = await supabase
      .from('vehicle_projects')
      .delete()
      .eq('id', projectId);
    
    if (error) throw error;
  }

  // Task methods
  static async getTasks(userId: string, filter?: TaskFilter, sort?: TaskSort): Promise<VehicleTask[]> {
    let query = supabase
      .from('vehicle_tasks')
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        project:vehicle_projects(id, title),
        vehicle:vehicles(id, make, model, year)
      `)
      .eq('owner_id', userId);

    // Apply filters
    if (filter) {
      if (filter.vehicle_id) query = query.eq('vehicle_id', filter.vehicle_id);
      if (filter.category_id) query = query.eq('category_id', filter.category_id);
      if (filter.priority_id) query = query.eq('priority_id', filter.priority_id);
      if (filter.status_id) query = query.eq('status_id', filter.status_id);
      if (filter.is_blocking !== undefined) query = query.eq('is_blocking_other_tasks', filter.is_blocking);
      if (filter.blocks_vehicle_operation !== undefined) query = query.eq('blocks_vehicle_operation', filter.blocks_vehicle_operation);
      if (filter.requires_professional_help !== undefined) query = query.eq('requires_professional_help', filter.requires_professional_help);
      if (filter.target_date_before) query = query.lte('target_completion_date', filter.target_date_before);
      if (filter.target_date_after) query = query.gte('target_completion_date', filter.target_date_after);
    }

    // Apply sorting
    if (sort) {
      if (sort.field === 'priority') {
        query = query.order('priority_levels(level)', { ascending: sort.direction === 'asc' });
      } else {
        query = query.order(sort.field, { ascending: sort.direction === 'asc' });
      }
    } else {
      // Default sort: priority first, then target date
      query = query.order('priority_levels(level)', { ascending: true })
                   .order('target_completion_date', { ascending: true });
    }

    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  }

  static async getTaskById(taskId: string): Promise<VehicleTask | null> {
    const { data, error } = await supabase
      .from('vehicle_tasks')
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        project:vehicle_projects(id, title),
        vehicle:vehicles(id, make, model, year),
        parts:task_parts(*),
        tools:task_tools(*),
        dependencies:task_dependencies(
          *,
          depends_on_task:vehicle_tasks(id, title, status:task_statuses(*))
        ),
        time_entries:task_time_entries(*)
      `)
      .eq('id', taskId)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async createTask(taskData: CreateTaskData): Promise<VehicleTask> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('vehicle_tasks')
      .insert({
        ...taskData,
        owner_id: user.user.id
      })
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        project:vehicle_projects(id, title),
        vehicle:vehicles(id, make, model, year)
      `)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async updateTask(taskId: string, updates: Partial<CreateTaskData>): Promise<VehicleTask> {
    const { data, error } = await supabase
      .from('vehicle_tasks')
      .update(updates)
      .eq('id', taskId)
      .select(`
        *,
        category:project_categories(*),
        priority:priority_levels(*),
        status:task_statuses(*),
        project:vehicle_projects(id, title),
        vehicle:vehicles(id, make, model, year)
      `)
      .single();
    
    if (error) throw error;
    return data;
  }

  static async deleteTask(taskId: string): Promise<void> {
    const { error } = await supabase
      .from('vehicle_tasks')
      .delete()
      .eq('id', taskId);
    
    if (error) throw error;
  }

  // Parts methods
  static async getTaskParts(taskId: string): Promise<TaskPart[]> {
    const { data, error } = await supabase
      .from('task_parts')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at');
    
    if (error) throw error;
    return data || [];
  }

  static async createTaskPart(partData: CreatePartData): Promise<TaskPart> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('task_parts')
      .insert({
        ...partData,
        owner_id: user.user.id
      })
      .select('*')
      .single();
    
    if (error) throw error;
    return data;
  }

  static async updateTaskPart(partId: string, updates: Partial<CreatePartData>): Promise<TaskPart> {
    const { data, error } = await supabase
      .from('task_parts')
      .update(updates)
      .eq('id', partId)
      .select('*')
      .single();
    
    if (error) throw error;
    return data;
  }

  // Tools methods
  static async getTaskTools(taskId: string): Promise<TaskTool[]> {
    const { data, error } = await supabase
      .from('task_tools')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at');
    
    if (error) throw error;
    return data || [];
  }

  static async createTaskTool(toolData: CreateToolData): Promise<TaskTool> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('task_tools')
      .insert({
        ...toolData,
        owner_id: user.user.id
      })
      .select('*')
      .single();
    
    if (error) throw error;
    return data;
  }

  static async updateTaskTool(toolId: string, updates: Partial<CreateToolData>): Promise<TaskTool> {
    const { data, error } = await supabase
      .from('task_tools')
      .update(updates)
      .eq('id', toolId)
      .select('*')
      .single();
    
    if (error) throw error;
    return data;
  }

  // Dashboard and summary methods
  static async getProjectSummary(userId: string): Promise<ProjectSummary> {
    const { data, error } = await supabase.rpc('get_project_summary', {
      user_id: userId
    });
    
    if (error) {
      // Fallback to manual calculation if RPC doesn't exist
      return this.calculateProjectSummaryManually(userId);
    }
    
    return data;
  }

  private static async calculateProjectSummaryManually(userId: string): Promise<ProjectSummary> {
    // Get all projects and tasks for the user
    const [projects, tasks] = await Promise.all([
      this.getProjects(userId),
      this.getTasks(userId)
    ]);

    const completedStatuses = await supabase
      .from('task_statuses')
      .select('id')
      .eq('is_completed', true);

    const completedStatusIds = completedStatuses.data?.map((s: any) => s.id) || [];

    return {
      total_projects: projects.length,
      total_tasks: tasks.length,
      completed_projects: projects.filter(p => completedStatusIds.includes(p.status_id || '')).length,
      completed_tasks: tasks.filter(t => completedStatusIds.includes(t.status_id || '')).length,
      total_estimated_cost: projects.reduce((sum, p) => sum + (p.estimated_cost || 0), 0),
      total_actual_cost: projects.reduce((sum, p) => sum + (p.actual_cost || 0), 0),
      total_estimated_hours: projects.reduce((sum, p) => sum + (p.estimated_hours || 0), 0),
      total_actual_hours: projects.reduce((sum, p) => sum + (p.actual_hours || 0), 0),
      pending_parts_count: 0, // Would need to query parts table
      pending_tools_count: 0, // Would need to query tools table
      blocking_tasks_count: tasks.filter(t => t.is_blocking_other_tasks).length,
      overdue_tasks_count: tasks.filter(t => 
        t.target_completion_date && 
        new Date(t.target_completion_date) < new Date() &&
        !completedStatusIds.includes(t.status_id || '')
      ).length
    };
  }

  static async getVehicleSummaries(userId: string): Promise<VehicleSummary[]> {
    const tasks = await this.getTasks(userId);
    const projects = await this.getProjects(userId);
    
    const vehicleMap = new Map<string, VehicleSummary>();
    
    // Process projects
    projects.forEach(project => {
      if (!vehicleMap.has(project.vehicle_id)) {
        vehicleMap.set(project.vehicle_id, {
          vehicle_id: project.vehicle_id,
          vehicle_make: project.vehicle?.make || '',
          vehicle_model: project.vehicle?.model || '',
          vehicle_year: project.vehicle?.year,
          total_projects: 0,
          total_tasks: 0,
          completed_projects: 0,
          completed_tasks: 0,
          total_estimated_cost: 0,
          total_actual_cost: 0,
          pending_parts_count: 0,
          blocking_tasks_count: 0,
          overdue_tasks_count: 0,
          highest_priority_level: 5
        });
      }
      
      const summary = vehicleMap.get(project.vehicle_id)!;
      summary.total_projects++;
      summary.total_estimated_cost += project.estimated_cost || 0;
      summary.total_actual_cost += project.actual_cost || 0;
    });
    
    // Process tasks
    tasks.forEach(task => {
      const summary = vehicleMap.get(task.vehicle_id);
      if (summary) {
        summary.total_tasks++;
        summary.blocking_tasks_count += task.is_blocking_other_tasks ? 1 : 0;
        
        if (task.priority?.level && task.priority.level < summary.highest_priority_level) {
          summary.highest_priority_level = task.priority.level;
        }
        
        if (task.target_completion_date && 
            new Date(task.target_completion_date) < new Date() &&
            !task.status?.is_completed) {
          summary.overdue_tasks_count++;
        }
      }
    });
    
    return Array.from(vehicleMap.values());
  }

  static async getDailyTaskList(userId: string): Promise<DailyTaskList> {
    const tasks = await this.getTasks(userId);
    const priorities = await this.getPriorityLevels();
    
    const criticalLevel = priorities.find(p => p.name === 'Critical')?.level || 1;
    const highLevel = priorities.find(p => p.name === 'High')?.level || 2;
    const lowLevel = priorities.find(p => p.name === 'Low')?.level || 4;
    
    const waitingForPartsStatus = await supabase
      .from('task_statuses')
      .select('id')
      .eq('name', 'Waiting for Parts')
      .single();
    
    const waitingForToolsStatus = await supabase
      .from('task_statuses')
      .select('id')
      .eq('name', 'Waiting for Tools')
      .single();
    
    return {
      critical_tasks: tasks.filter(t => t.priority?.level === criticalLevel),
      high_priority_tasks: tasks.filter(t => t.priority?.level === highLevel),
      waiting_for_parts: tasks.filter(t => t.status_id === waitingForPartsStatus.data?.id),
      waiting_for_tools: tasks.filter(t => t.status_id === waitingForToolsStatus.data?.id),
      quick_tasks: tasks.filter(t => (t.estimated_hours || 0) <= 1 && t.priority?.level !== criticalLevel),
      fill_in_tasks: tasks.filter(t => t.priority?.level === lowLevel)
    };
  }

  // Time tracking methods
  static async startTimeTracking(taskId: string, description?: string): Promise<TaskTimeEntry> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('task_time_entries')
      .insert({
        task_id: taskId,
        owner_id: user.user.id,
        start_time: new Date().toISOString(),
        description
      })
      .select('*')
      .single();
    
    if (error) throw error;
    return data;
  }

  static async stopTimeTracking(entryId: string): Promise<TaskTimeEntry> {
    const endTime = new Date();
    
    // Get the entry to calculate duration
    const { data: entry } = await supabase
      .from('task_time_entries')
      .select('start_time')
      .eq('id', entryId)
      .single();
    
    let duration_minutes = 0;
    if (entry) {
      const startTime = new Date(entry.start_time);
      duration_minutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
    }

    const { data, error } = await supabase
      .from('task_time_entries')
      .update({
        end_time: endTime.toISOString(),
        duration_minutes
      })
      .eq('id', entryId)
      .select('*')
      .single();
    
    if (error) throw error;
    return data;
  }
}
