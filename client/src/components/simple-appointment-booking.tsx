import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Clock, User, Stethoscope, FileText } from 'lucide-react';

export default function SimpleAppointmentBooking({ user }: { user: any }) {
  const [bookingForm, setBookingForm] = useState({
    type: '',
    provider: '',
    date: '',
    time: '',
    doctorName: '',
    reason: ''
  });
  const [showTimeSlots, setShowTimeSlots] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<Array<{
    time: string;
    doctor: string;
    doctorId: number;
    doctorEmail: string;
  }>>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch appointments with real-time updates
  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['/api/patient/appointments'],
    queryFn: async () => {
      const response = await fetch('/api/patient/appointments', {
        credentials: 'include'
      });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 5000, // Refetch every 5 seconds
    refetchOnWindowFocus: true
  });

  // Fetch available doctors in real-time
  const { data: availableDoctors = [] } = useQuery({
    queryKey: ['/api/doctors/available'],
    queryFn: async () => {
      const response = await fetch('/api/doctors/available', {
        credentials: 'include'
      });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchOnWindowFocus: true
  });

  // Book appointment mutation
  const bookAppointmentMutation = useMutation({
    mutationFn: async (appointmentData: {
      patientId: number;
      appointmentDate: string;
      appointmentTime: string;
      type: string;
      provider: string;
      doctorName: string;
      doctorEmail: string;
      reason: string;
    }) => {
      const response = await fetch('/api/patient/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(appointmentData)
      });
      if (!response.ok) throw new Error('Failed to book appointment');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments'] });
      toast({
        title: "Appointment Booked!",
        description: `${bookingForm.type} scheduled for ${bookingForm.date} at ${bookingForm.time}`,
      });
      setBookingForm({ type: '', provider: '', date: '', time: '', doctorName: '', reason: '' });
      setShowTimeSlots(false);
    },
    onError: () => {
      toast({
        title: "Booking Failed",
        description: "Unable to book appointment. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleCheckAvailability = async () => {
    if (!bookingForm.type || !bookingForm.date) {
      toast({
        title: "Missing Information",
        description: "Please select appointment type and date.",
        variant: "destructive",
      });
      return;
    }

    setLoadingSlots(true);
    try {
      // Check real availability from server
      const response = await fetch(`/api/appointments/available-slots?date=${bookingForm.date}&type=${bookingForm.type}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const serverSlots = await response.json();
        setAvailableSlots(serverSlots);
      } else {
        // Fallback: Generate slots and check against existing appointments
        const allTimeSlots = ['09:00 AM', '10:30 AM', '02:00 PM', '03:30 PM', '04:00 PM'];
        const bookedSlots = appointments
          .filter((apt: any) => apt.appointmentDate === bookingForm.date)
          .map((apt: any) => apt.appointmentTime);
        
        const availableTimeSlots = allTimeSlots.filter(time => !bookedSlots.includes(time));
        
        const slots = availableTimeSlots.map(time => {
          const doctor = availableDoctors.find((d: any) => d.role === (bookingForm.provider || 'doctor')) || availableDoctors[0];
          return {
            time,
            doctor: doctor?.name || (bookingForm.provider === 'radiologist' ? 'Dr. Radiologist' : 'Dr. Available'),
            doctorId: doctor?.id || 1,
            doctorEmail: doctor?.email || 'doctor@healthai.com'
          };
        });
        
        setAvailableSlots(slots);
      }
      
      setShowTimeSlots(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to check availability. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleBookSlot = async (slot: {
    time: string;
    doctor: string;
    doctorId: number;
    doctorEmail: string;
  }) => {
    const appointmentData = {
      patientId: user.id,
      appointmentDate: bookingForm.date,
      appointmentTime: slot.time,
      type: bookingForm.type,
      provider: bookingForm.provider,
      doctorName: slot.doctor,
      doctorEmail: slot.doctorEmail,
      reason: bookingForm.reason
    };
    
    // Create Google Calendar event
    const calendarEvent: {
      summary: string;
      description: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
      attendees: Array<{ email: string }>;
    } = {
      summary: `${bookingForm.type} - ${user.fullName}`,
      description: `Patient: ${user.fullName}\nReason: ${bookingForm.reason}\nDoctor: ${slot.doctor}`,
      start: {
        dateTime: new Date(`${bookingForm.date}T${convertTo24Hour(slot.time)}`).toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: new Date(new Date(`${bookingForm.date}T${convertTo24Hour(slot.time)}`).getTime() + 60*60*1000).toISOString(),
        timeZone: 'UTC'
      },
      attendees: [
        { email: user.email },
        { email: slot.doctorEmail }
      ]
    };
    
    try {
      // Add to Google Calendar
      await addToGoogleCalendar(calendarEvent);
      bookAppointmentMutation.mutate(appointmentData);
    } catch (error) {
      toast({
        title: "Calendar Error",
        description: "Appointment booked but failed to add to calendar.",
        variant: "destructive",
      });
      bookAppointmentMutation.mutate(appointmentData);
    }
  };
  
  const convertTo24Hour = (time12h: string) => {
    const [time, modifier] = time12h.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') hours = '00';
    if (modifier === 'PM') hours = String(parseInt(hours, 10) + 12);
    return `${hours.padStart(2, '0')}:${minutes}:00`;
  };
  
  const addToGoogleCalendar = async (event: {
    summary: string;
    description: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    attendees: Array<{ email: string }>;
  }) => {
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.summary)}&dates=${event.start.dateTime.replace(/[-:]/g, '').split('.')[0]}Z/${event.end.dateTime.replace(/[-:]/g, '').split('.')[0]}Z&details=${encodeURIComponent(event.description)}&location=HealthAI%20Medical%20Center`;
    window.open(calendarUrl, '_blank');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'completed': return 'bg-green-100 text-green-800 border-green-300';
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Schedule New Appointment */}
        <div className="xl:col-span-2">
          <Card className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center text-slate-900 dark:text-white">
                  <Calendar className="w-5 h-5 mr-2 text-slate-600" />
                  Schedule New Appointment
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="type" className="font-semibold text-gray-800 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4" />
                  Appointment Type
                </Label>
                <Select value={bookingForm.type} onValueChange={(value) => setBookingForm({...bookingForm, type: value})}>
                  <SelectTrigger className="border border-slate-300 focus:border-slate-500 bg-slate-50 focus:bg-white">
                    <SelectValue placeholder="Choose consultation type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consultation">🩺 General Consultation</SelectItem>
                    <SelectItem value="follow-up">📋 Follow-up Visit</SelectItem>
                    <SelectItem value="screening">🔬 Cancer Screening</SelectItem>
                    <SelectItem value="urgent">🚨 Emergency Care</SelectItem>
                    <SelectItem value="radiology">📸 Diagnostic Imaging</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="provider" className="font-semibold text-gray-800 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Healthcare Provider
                </Label>
                <Select value={bookingForm.provider || ''} onValueChange={(value) => setBookingForm({...bookingForm, provider: value})}>
                  <SelectTrigger className="border border-slate-300 focus:border-slate-500 bg-slate-50 focus:bg-white">
                    <SelectValue placeholder="Select doctor or radiologist" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="doctor">👨‍⚕️ Doctor</SelectItem>
                    <SelectItem value="radiologist">🔬 Radiologist</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date" className="font-semibold text-gray-800 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Appointment Date
                  </Label>
                  <Input
                    id="date"
                    type="date"
                    value={bookingForm.date}
                    onChange={(e) => {
                      setBookingForm({...bookingForm, date: e.target.value});
                      setShowTimeSlots(false);
                    }}
                    min={new Date().toISOString().split('T')[0]}
                    className="border border-slate-300 focus:border-slate-500 bg-white focus:bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time" className="font-semibold text-gray-800 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Available Times
                  </Label>
                  <Button 
                    onClick={handleCheckAvailability}
                    disabled={!bookingForm.type || !bookingForm.date || loadingSlots}
                    className="w-full border border-slate-300 bg-white hover:bg-slate-50"
                    variant="outline"
                  >
                    {loadingSlots ? 'Loading...' : 'Check Available Times'}
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="reason" className="font-semibold text-gray-800 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Reason for Visit
                </Label>
                <Textarea
                  id="reason"
                  value={bookingForm.reason}
                  onChange={(e) => setBookingForm({...bookingForm, reason: e.target.value})}
                  placeholder="Describe your symptoms or reason for the appointment..."
                  rows={3}
                  className="border border-slate-300 focus:border-slate-500 bg-white focus:bg-white resize-none"
                />
              </div>
              
              {showTimeSlots && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <h4 className="font-semibold text-slate-700 mb-3">Available Time Slots</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {availableSlots.length > 0 ? (
                      availableSlots.map((slot, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          onClick={() => handleBookSlot(slot)}
                          disabled={bookAppointmentMutation.isPending}
                          className="p-4 text-left border-slate-300 hover:bg-slate-100 transition-all h-auto"
                        >
                          <div className="flex justify-between items-start w-full">
                            <div className="space-y-1">
                              <div className="font-bold text-lg text-slate-700">{slot.time}</div>
                              <div className="text-sm font-medium text-slate-600">{slot.doctor}</div>
                              <div className="text-xs text-green-600 font-medium flex items-center">
                                <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
                                Available Now
                              </div>
                            </div>
                            <Stethoscope className="w-5 h-5 text-slate-500 mt-1" />
                          </div>
                        </Button>
                      ))
                    ) : (
                      <div className="text-center py-4 text-slate-600 col-span-2">
                        <p className="font-medium">No slots available for selected date</p>
                        <p className="text-sm">Please try a different date</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        {/* Appointment Summary */}
        <div>
          <Card className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white">Your Appointments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <div className="p-3 bg-slate-50 dark:bg-slate-900/20 rounded-lg">
                  <p className="text-sm text-slate-600 dark:text-slate-400">Total</p>
                  <p className="text-2xl font-bold text-slate-700 dark:text-slate-300">{appointments.length}</p>
                </div>
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                  <p className="text-sm text-amber-600 dark:text-amber-400">Scheduled</p>
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                    {appointments.filter((a: any) => a.status === 'scheduled').length}
                  </p>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-sm text-green-600 dark:text-green-400">Completed</p>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                    {appointments.filter((a: any) => a.status === 'completed').length}
                  </p>
                </div>
              </div>
              
              <div className="pt-4 border-t border-slate-200 dark:border-slate-600">
                <h4 className="font-medium text-slate-900 dark:text-white mb-3">Recent Appointments</h4>
                <div className="space-y-2">
                  {appointments.slice(0, 3).map((apt: any) => (
                    <div key={apt.id} className="flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-400 truncate">{apt.type || 'Consultation'}</span>
                      <span className="text-slate-900 dark:text-white font-medium ml-2">
                        {new Date(apt.appointmentDate || apt.date).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                  {appointments.length === 0 && (
                    <p className="text-sm text-slate-400 dark:text-slate-500">No appointments yet</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* Appointments List */}
      <Card className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center text-slate-900 dark:text-white">
            <Clock className="w-5 h-5 mr-2 text-blue-600" />
            All Appointments ({appointments.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => (
                  <div key={i} className="h-20 bg-slate-100 dark:bg-slate-700 rounded animate-pulse"></div>
                ))}
              </div>
            ) : appointments.length > 0 ? (
              appointments.map((appointment: any) => (
                <div key={appointment.id} className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                          <h4 className="font-medium text-slate-900 dark:text-white">{appointment.type || 'Consultation'}</h4>
                          <p className="text-sm text-slate-600 dark:text-slate-400">{appointment.doctorName || 'Dr. Available'}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Date & Time:</span>
                          <p className="text-slate-900 dark:text-white font-medium">
                            {new Date(appointment.appointmentDate || appointment.date).toLocaleDateString()} at {appointment.appointmentTime || appointment.time}
                          </p>
                        </div>
                        {appointment.reason && (
                          <div>
                            <span className="text-slate-500 dark:text-slate-400">Reason:</span>
                            <p className="text-slate-900 dark:text-white">{appointment.reason}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end space-y-2">
                      <Badge className={getStatusColor(appointment.status)}>
                        {appointment.status?.toUpperCase() || 'SCHEDULED'}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <p className="text-slate-500 dark:text-slate-400">No appointments found</p>
                <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Schedule your first appointment above</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}