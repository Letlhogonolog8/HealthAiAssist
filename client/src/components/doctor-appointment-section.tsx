import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MessageSquare, Activity, Calendar, Clock, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface Appointment {
  id: number;
  patientName: string;
  patientEmail: string;
  date: string;
  time: string;
  type: string;
  status: string;
  notes?: string;
  patientId: number;
  reason?: string;
  priority?: string;
}

export function DoctorAppointmentSection({ user }: { user: any }) {
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: appointments, isLoading } = useQuery<Appointment[]>({
    queryKey: ['/api/doctor/appointments/upcoming'],
    refetchInterval: 15000
  });

  const acceptAppointment = useMutation({
    mutationFn: (appointmentId: number) => 
      apiRequest(`/api/doctor/appointments/${appointmentId}/accept`, 'POST'),
    onSuccess: () => {
      toast({
        title: "Appointment Accepted",
        description: "The appointment has been confirmed.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/upcoming'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to accept appointment.",
        variant: "destructive",
      });
    }
  });

  const declineAppointment = useMutation({
    mutationFn: ({ appointmentId, reason }: { appointmentId: number; reason: string }) => 
      apiRequest(`/api/doctor/appointments/${appointmentId}/decline`, 'POST', { reason }),
    onSuccess: () => {
      toast({
        title: "Appointment Declined",
        description: "The appointment has been declined.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/upcoming'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to decline appointment.",
        variant: "destructive",
      });
    }
  });

  const deleteAppointment = useMutation({
    mutationFn: (appointmentId: number) => 
      apiRequest(`/api/doctor/appointments/${appointmentId}`, 'DELETE'),
    onSuccess: () => {
      toast({
        title: "Appointment Deleted",
        description: "The appointment has been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/upcoming'] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete appointment.",
        variant: "destructive",
      });
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today's Appointments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-blue-600" />
          Upcoming Appointments ({appointments?.length || 0})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {appointments && appointments.length > 0 ? (
            appointments.map((appointment) => (
              <div key={appointment.id} className="flex items-center justify-between p-4 border rounded-lg bg-gradient-to-r from-white to-blue-50 dark:from-gray-800 dark:to-blue-900/20">
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                    <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">{appointment.patientName}</h4>
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Clock className="h-3 w-3 mr-1" />
                      {appointment.time} - {new Date(appointment.date).toLocaleDateString()}
                    </div>
                    <p className="text-sm text-muted-foreground">{appointment.type}</p>
                    {appointment.reason && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">{appointment.reason}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge 
                    variant={
                      appointment.status === 'accepted' ? 'default' :
                      appointment.status === 'confirmed' ? 'default' :
                      appointment.status === 'declined' ? 'destructive' :
                      appointment.status === 'scheduled' ? 'secondary' : 'outline'
                    }
                  >
                    {appointment.status}
                  </Badge>
                  
                  {appointment.status === 'scheduled' && (
                    <div className="flex space-x-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => acceptAppointment.mutate(appointment.id)}
                        disabled={acceptAppointment.isPending}
                        className="text-green-600 hover:text-green-700 border-green-200 hover:border-green-300"
                      >
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => declineAppointment.mutate({ appointmentId: appointment.id, reason: 'Schedule conflict' })}
                        disabled={declineAppointment.isPending}
                        className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteAppointment.mutate(appointment.id)}
                    disabled={deleteAppointment.isPending}
                    className="text-gray-600 hover:text-red-600 border-gray-200 hover:border-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    /**
                     * Emails the patient. It used to offer to call them, on
                     * +1234567890.
                     *
                     * That literal was used for all three actions — the Call
                     * button, the SMS link, and the "Click OK to call" branch of
                     * the confirm dialog — for every patient, regardless of who
                     * they were. A doctor pressing Call was dialling a number
                     * belonging to nobody while believing they were reaching the
                     * patient in front of them; for an appointment that needed
                     * confirming or a result that needed discussing, that is a
                     * missed contact the doctor has no reason to suspect.
                     *
                     * The email fallback was the same shape: `patientEmail ||
                     * 'patient@example.com'`, so a patient with no address on
                     * file got a message composed to example.com.
                     *
                     * This platform does not surface patient phone numbers to
                     * this screen, so the call and SMS options are gone rather
                     * than pointed somewhere plausible. Email is offered only
                     * when there is a real address to use.
                     */
                    disabled={!appointment.patientEmail}
                    title={
                      appointment.patientEmail
                        ? `Email ${appointment.patientName}`
                        : 'No email address is on file for this patient'
                    }
                    onClick={() => {
                      if (!appointment.patientEmail) return;
                      const subject = `Regarding your appointment on ${appointment.date}`;
                      const body =
                        `Dear ${appointment.patientName},%0D%0A%0D%0A` +
                        `This is regarding your upcoming appointment scheduled for ` +
                        `${appointment.date} at ${appointment.time}.%0D%0A%0D%0A` +
                        `Best regards,%0D%0A${user?.fullName || 'Your clinician'}`;
                      window.open(
                        `mailto:${appointment.patientEmail}?subject=${encodeURIComponent(subject)}&body=${body}`
                      );
                    }}
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Contact
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p className="text-lg font-medium">No appointments scheduled for today</p>
              <p className="text-sm">Check back later or review upcoming appointments</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}