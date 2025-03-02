
import { format } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Appointment } from './types/scheduleTypes';
import { Badge } from '@/components/ui/badge';

interface AppointmentListProps {
  appointments: Appointment[];
  onAppointmentClick: (appointment: Appointment) => void;
}

export const AppointmentList = ({
  appointments,
  onAppointmentClick,
}: AppointmentListProps) => {
  // Sort appointments by start time
  const sortedAppointments = [...appointments].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date & Time</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Vehicle</TableHead>
          <TableHead>Technician</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedAppointments.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center py-8 text-gray-500">
              No appointments found
            </TableCell>
          </TableRow>
        ) : (
          sortedAppointments.map((appointment) => (
            <TableRow 
              key={appointment.id} 
              className="cursor-pointer hover:bg-gray-100"
              onClick={() => onAppointmentClick(appointment)}
            >
              <TableCell>
                <div className="font-medium">{format(appointment.startTime, 'MMM dd, yyyy')}</div>
                <div className="text-gray-500 text-sm">
                  {format(appointment.startTime, 'h:mm a')} - {format(appointment.endTime, 'h:mm a')}
                </div>
              </TableCell>
              <TableCell>{appointment.title}</TableCell>
              <TableCell>{appointment.vehicleName || '-'}</TableCell>
              <TableCell>{appointment.technicianName || '-'}</TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {appointment.type}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge 
                  variant={appointment.status === 'completed' ? 'outline' : 'default'}
                  className="capitalize"
                >
                  {appointment.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
};
