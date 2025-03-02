
import { useState, useEffect } from 'react';
import { Calendar, Clock, Users, Car, Filter } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalendarView } from '@/components/schedule/CalendarView';
import { AppointmentForm } from '@/components/schedule/AppointmentForm';
import { ScheduleFilters } from '@/components/schedule/ScheduleFilters';
import { AppointmentList } from '@/components/schedule/AppointmentList';
import { ScheduleSummary } from '@/components/schedule/ScheduleSummary';
import { Appointment } from '@/components/schedule/types/scheduleTypes';
import { useToast } from '@/hooks/use-toast';

const Schedule = () => {
  const { toast } = useToast();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | undefined>(undefined);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filteredAppointments, setFilteredAppointments] = useState<Appointment[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: undefined
  });

  // Mock data for vehicles and technicians
  const vehicles = [
    { id: '1', name: '2019 Toyota Camry' },
    { id: '2', name: '2020 Honda CR-V' },
    { id: '3', name: '2018 Ford F-150' },
  ];

  const technicians = [
    { id: '1', name: 'Alex Johnson' },
    { id: '2', name: 'Maria Garcia' },
    { id: '3', name: 'Sam Wilson' },
  ];

  // Fetch appointments (mock implementation)
  useEffect(() => {
    // This would be replaced with an actual API call
    const mockAppointments: Appointment[] = [
      {
        id: '1',
        title: 'Oil Change',
        description: 'Regular maintenance',
        startTime: new Date(2023, 6, 10, 9, 0),
        endTime: new Date(2023, 6, 10, 10, 30),
        vehicleId: '1',
        vehicleName: '2019 Toyota Camry',
        technicianId: '1',
        technicianName: 'Alex Johnson',
        status: 'scheduled',
        type: 'maintenance',
        location: 'Main Garage',
        color: '#4CAF50',
      },
      {
        id: '2',
        title: 'Brake Inspection',
        description: 'Check brake pads and rotors',
        startTime: new Date(2023, 6, 12, 14, 0),
        endTime: new Date(2023, 6, 12, 15, 0),
        vehicleId: '2',
        vehicleName: '2020 Honda CR-V',
        technicianId: '2',
        technicianName: 'Maria Garcia',
        status: 'scheduled',
        type: 'inspection',
        location: 'Main Garage',
        color: '#2196F3',
      },
    ];

    setAppointments(mockAppointments);
    setFilteredAppointments(mockAppointments);
  }, []);

  const handleAppointmentClick = (appointment: Appointment) => {
    setSelectedAppointment(appointment);
    setIsFormOpen(true);
  };

  const handleDateSelect = (date: Date) => {
    setCurrentDate(date);
  };

  const handleFormSubmit = (appointment: Appointment) => {
    // If editing an existing appointment
    if (selectedAppointment) {
      const updatedAppointments = appointments.map(app => 
        app.id === appointment.id ? appointment : app
      );
      setAppointments(updatedAppointments);
      setFilteredAppointments(updatedAppointments);
      toast({
        title: "Appointment Updated",
        description: `${appointment.title} has been updated.`
      });
    } else {
      // Creating a new appointment
      const newAppointment = {
        ...appointment,
        id: Date.now().toString(), // Simple ID generation for demo
      };
      const updatedAppointments = [...appointments, newAppointment];
      setAppointments(updatedAppointments);
      setFilteredAppointments(updatedAppointments);
      toast({
        title: "Appointment Created",
        description: `${appointment.title} has been scheduled.`
      });
    }

    setIsFormOpen(false);
    setSelectedAppointment(undefined);
  };

  const handleFilterChange = (filters: any) => {
    // Apply filters to appointments
    let filtered = [...appointments];

    if (filters.appointmentType?.length) {
      filtered = filtered.filter(app => filters.appointmentType.includes(app.type));
    }

    if (filters.status?.length) {
      filtered = filtered.filter(app => filters.status.includes(app.status));
    }

    if (filters.vehicleId) {
      filtered = filtered.filter(app => app.vehicleId === filters.vehicleId);
    }

    if (filters.technicianId) {
      filtered = filtered.filter(app => app.technicianId === filters.technicianId);
    }

    if (filters.dateRange?.start && filters.dateRange?.end) {
      filtered = filtered.filter(app => 
        app.startTime >= filters.dateRange.start && 
        app.startTime <= filters.dateRange.end
      );
    }

    setFilteredAppointments(filtered);
    setIsFilterOpen(false);
  };

  return (
    <div className="container mx-auto py-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <h1 className="text-3xl font-bold">Schedule</h1>
        <div className="flex mt-4 md:mt-0 space-x-2">
          <Button 
            variant="outline" 
            onClick={() => setIsFilterOpen(!isFilterOpen)}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button onClick={() => {
            setSelectedAppointment(undefined);
            setIsFormOpen(true);
          }}>
            Add Appointment
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <ScheduleSummary
          title="Total Appointments"
          value={appointments.length}
          icon={<Calendar className="h-5 w-5" />}
        />
        <ScheduleSummary
          title="Scheduled Today"
          value={appointments.filter(a => 
            format(a.startTime, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
          ).length}
          icon={<Clock className="h-5 w-5" />}
        />
        <ScheduleSummary
          title="Active Technicians"
          value={technicians.length}
          icon={<Users className="h-5 w-5" />}
        />
        <ScheduleSummary
          title="Vehicles in Service"
          value={vehicles.length}
          icon={<Car className="h-5 w-5" />}
        />
      </div>

      {isFilterOpen && (
        <div className="mb-6 p-4 border rounded-md">
          <ScheduleFilters
            onFilterChange={handleFilterChange}
            currentFilters={{}}
            availableVehicles={vehicles}
            availableTechnicians={technicians}
          />
        </div>
      )}

      <Tabs defaultValue="calendar" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
        </TabsList>
        
        <TabsContent value="calendar" className="space-y-4">
          <div className="flex justify-end space-x-2 mb-4">
            <Button 
              variant={calendarView === 'month' ? 'default' : 'outline'} 
              onClick={() => setCalendarView('month')}
              size="sm"
            >
              Month
            </Button>
            <Button 
              variant={calendarView === 'week' ? 'default' : 'outline'} 
              onClick={() => setCalendarView('week')}
              size="sm"
            >
              Week
            </Button>
            <Button 
              variant={calendarView === 'day' ? 'default' : 'outline'} 
              onClick={() => setCalendarView('day')}
              size="sm"
            >
              Day
            </Button>
          </div>
          
          <CalendarView
            appointments={filteredAppointments}
            onAppointmentClick={handleAppointmentClick}
            onDateSelect={handleDateSelect}
            view={calendarView}
            currentDate={currentDate}
            onViewChange={setCalendarView}
          />
        </TabsContent>
        
        <TabsContent value="list">
          <AppointmentList 
            appointments={filteredAppointments}
            onAppointmentClick={handleAppointmentClick}
          />
        </TabsContent>
      </Tabs>

      {isFormOpen && (
        <AppointmentForm
          appointment={selectedAppointment}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setIsFormOpen(false);
            setSelectedAppointment(undefined);
          }}
          vehicles={vehicles}
          technicians={technicians}
        />
      )}
    </div>
  );
};

export default Schedule;
