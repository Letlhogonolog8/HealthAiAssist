import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, CheckCircle, XCircle, Clock, MessageSquare } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface AppointmentResponseModalProps {
  appointment: {
    id: number;
    patientName: string;
    patientEmail: string;
    date: string;
    time: string;
    type: string;
    status: string;
    notes?: string;
  };
  isOpen: boolean;
  onClose: () => void;
}

export function AppointmentResponseModal({ appointment, isOpen, onClose }: AppointmentResponseModalProps) {
  const [responseType, setResponseType] = useState<string>('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const respondToAppointment = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/doctor/appointments/${appointment.id}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to respond to appointment');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Appointment response sent successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/today'] });
      onClose();
      resetForm();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to respond to appointment",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setResponseType('');
    setDoctorNotes('');
    setNewDate('');
    setNewTime('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!responseType) {
      toast({
        title: "Error",
        description: "Please select a response type",
        variant: "destructive",
      });
      return;
    }

    const responseData: any = {
      status: responseType,
      doctorNotes: doctorNotes.trim(),
    };

    if (responseType === 'rescheduled' && newDate && newTime) {
      responseData.newDate = newDate;
      responseData.newTime = newTime;
    }

    respondToAppointment.mutate(responseData);
  };

  const getResponseIcon = (type: string) => {
    switch (type) {
      case 'confirmed': return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'cancelled': return <XCircle className="h-4 w-4 text-red-600" />;
      case 'rescheduled': return <Clock className="h-4 w-4 text-blue-600" />;
      default: return <MessageSquare className="h-4 w-4" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent aria-describedby={undefined} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Respond to Appointment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Appointment Details */}
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <div className="space-y-2 text-sm">
              <div><strong>Patient:</strong> {appointment.patientName}</div>
              <div><strong>Date:</strong> {new Date(appointment.date).toLocaleDateString()}</div>
              <div><strong>Time:</strong> {appointment.time}</div>
              <div><strong>Type:</strong> {appointment.type}</div>
              <div><strong>Status:</strong> 
                <span className={`ml-1 px-2 py-1 rounded text-xs ${
                  appointment.status === 'scheduled' ? 'bg-yellow-100 text-yellow-800' :
                  appointment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  appointment.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {appointment.status}
                </span>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Response Type */}
            <div>
              <Label htmlFor="responseType">Response Type</Label>
              <Select value={responseType} onValueChange={setResponseType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select response type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">
                    <div className="flex items-center gap-2">
                      {getResponseIcon('confirmed')}
                      Confirm Appointment
                    </div>
                  </SelectItem>
                  <SelectItem value="rescheduled">
                    <div className="flex items-center gap-2">
                      {getResponseIcon('rescheduled')}
                      Reschedule Appointment
                    </div>
                  </SelectItem>
                  <SelectItem value="cancelled">
                    <div className="flex items-center gap-2">
                      {getResponseIcon('cancelled')}
                      Cancel Appointment
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reschedule Options */}
            {responseType === 'rescheduled' && (
              <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <Label className="text-blue-800 dark:text-blue-200">New Appointment Details</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="newDate">New Date</Label>
                    <Input
                      id="newDate"
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="newTime">New Time</Label>
                    <Select value={newTime} onValueChange={setNewTime}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="9:00 AM">9:00 AM</SelectItem>
                        <SelectItem value="9:30 AM">9:30 AM</SelectItem>
                        <SelectItem value="10:00 AM">10:00 AM</SelectItem>
                        <SelectItem value="10:30 AM">10:30 AM</SelectItem>
                        <SelectItem value="11:00 AM">11:00 AM</SelectItem>
                        <SelectItem value="11:30 AM">11:30 AM</SelectItem>
                        <SelectItem value="2:00 PM">2:00 PM</SelectItem>
                        <SelectItem value="2:30 PM">2:30 PM</SelectItem>
                        <SelectItem value="3:00 PM">3:00 PM</SelectItem>
                        <SelectItem value="3:30 PM">3:30 PM</SelectItem>
                        <SelectItem value="4:00 PM">4:00 PM</SelectItem>
                        <SelectItem value="4:30 PM">4:30 PM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Doctor Notes */}
            <div>
              <Label htmlFor="doctorNotes">Notes to Patient (Optional)</Label>
              <Textarea
                id="doctorNotes"
                placeholder="Add any notes or instructions for the patient..."
                value={doctorNotes}
                onChange={(e) => setDoctorNotes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={respondToAppointment.isPending}
                className="flex-1"
              >
                {respondToAppointment.isPending ? 'Sending...' : 'Send Response'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}