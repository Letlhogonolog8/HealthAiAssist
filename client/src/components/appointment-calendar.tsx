import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Stethoscope,
  AlertCircle
} from 'lucide-react';

interface TimeSlot {
  time: string;
  available: boolean;
  doctor: string;
  type?: string;
}

interface CalendarDay {
  date: Date;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  appointments: any[];
  availableSlots: TimeSlot[];
}

interface AppointmentCalendarProps {
  user: any;
  appointment?: any;
  onReschedule?: (newDate: string, newTime: string) => void;
  mode?: 'reschedule' | 'book';
}

export default function AppointmentCalendar({ 
  user, 
  appointment, 
  onReschedule, 
  mode = 'reschedule' 
}: AppointmentCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [selectedAppointmentType, setSelectedAppointmentType] = useState<string>('');
  const [selectedDoctor, setSelectedDoctor] = useState<string>('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch available doctors from the database
  const { data: availableDoctors = [], isLoading: doctorsLoading } = useQuery({
    queryKey: ['/api/doctors/available'],
    queryFn: async () => {
      const response = await fetch('/api/doctors/available');
      return response.json();
    }
  });

  // Fetch available time slots for the selected month
  const { data: availableSlots, isLoading } = useQuery({
    queryKey: ['/api/appointments/available-slots', currentDate.getFullYear(), currentDate.getMonth()],
    queryFn: async () => {
      const response = await fetch(`/api/appointments/available-slots?year=${currentDate.getFullYear()}&month=${currentDate.getMonth() + 1}`);
      return response.json();
    }
  });

  // Book new appointment mutation
  const bookAppointmentMutation = useMutation({
    mutationFn: async ({ date, time, type, doctor }: { 
      date: string, 
      time: string,
      type: string,
      doctor: string
    }) => {
      const response = await fetch(`/api/patient/appointments`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ 
          patientId: user.id,
          appointmentDate: date, 
          appointmentTime: time,
          type: type,
          doctorName: doctor,
          status: 'scheduled'
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to book appointment');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments', user.id] });
      toast({
        title: "✅ Appointment Booked!",
        description: `Your appointment has been scheduled for ${selectedDate?.toLocaleDateString()} at ${selectedTime}`,
      });
      setShowConfirmation(false);
      setSelectedDate(null);
      setSelectedTime('');
      setSelectedAppointmentType('');
      setSelectedDoctor('');
    },
    onError: (error: any) => {
      toast({
        title: "Booking Failed",
        description: error.message || "Unable to book appointment.",
        variant: "destructive",
      });
    }
  });

  // One-click reschedule mutation
  const rescheduleAppointmentMutation = useMutation({
    mutationFn: async ({ appointmentId, newDate, newTime }: { 
      appointmentId: number, 
      newDate: string, 
      newTime: string 
    }) => {
      const response = await fetch(`/api/patient/appointments/${appointmentId}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDate, newTime })
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments', user.id] });
      toast({
        title: "✅ Appointment Rescheduled!",
        description: `Your appointment has been moved to ${selectedDate?.toLocaleDateString()} at ${selectedTime}`,
      });
      if (onReschedule) {
        onReschedule(selectedDate?.toISOString() || '', selectedTime);
      }
      setShowConfirmation(false);
      setSelectedDate(null);
      setSelectedTime('');
    },
    onError: (error: any) => {
      toast({
        title: "Reschedule Failed",
        description: error.message || "Unable to reschedule appointment.",
        variant: "destructive",
      });
    }
  });

  // Generate calendar days for current month
  useEffect(() => {
    generateCalendarDays();
  }, [currentDate, availableSlots]);

  const generateCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const today = new Date();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const days: CalendarDay[] = [];
    const currentDay = new Date(startDate);
    
    for (let i = 0; i < 42; i++) {
      const daySlots = availableSlots?.[currentDay.toISOString().split('T')[0]] || [];
      
      days.push({
        date: new Date(currentDay),
        dayNumber: currentDay.getDate(),
        isCurrentMonth: currentDay.getMonth() === month,
        isToday: currentDay.toDateString() === today.toDateString(),
        isSelected: selectedDate?.toDateString() === currentDay.toDateString(),
        appointments: [],
        availableSlots: daySlots
      });
      
      currentDay.setDate(currentDay.getDate() + 1);
    }
    
    setCalendarDays(days);
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  const selectDate = (day: CalendarDay) => {
    if (!day.isCurrentMonth || day.availableSlots.length === 0) return;
    
    setSelectedDate(day.date);
    setSelectedTime('');
  };

  const selectTimeSlot = (time: string, doctor: string) => {
    setSelectedTime(time);
    setSelectedDoctor(doctor);
  };

  const handleBookAppointment = () => {
    if (!selectedDate || !selectedTime || !selectedAppointmentType) return;
    
    setShowConfirmation(true);
  };

  const handleOneClickReschedule = () => {
    if (!selectedDate || !selectedTime || !appointment) return;
    
    setShowConfirmation(true);
  };

  const confirmBooking = () => {
    if (!selectedDate || !selectedTime || !selectedAppointmentType || !selectedDoctor) return;
    
    bookAppointmentMutation.mutate({
      date: selectedDate.toISOString(),
      time: selectedTime,
      type: selectedAppointmentType,
      doctor: selectedDoctor
    });
  };

  const confirmReschedule = () => {
    if (!selectedDate || !selectedTime || !appointment) return;
    
    rescheduleAppointmentMutation.mutate({
      appointmentId: appointment.id,
      newDate: selectedDate.toISOString(),
      newTime: selectedTime
    });
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-6">
      {/* Calendar Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5" />
              {mode === 'reschedule' ? 'Reschedule Appointment' : 'Book New Appointment'}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => navigateMonth('prev')}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="font-semibold min-w-[150px] text-center">
                {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
              </span>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => navigateMonth('next')}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {dayNames.map((day) => (
              <div key={day} className="text-center text-sm font-medium text-gray-500 p-2">
                {day}
              </div>
            ))}
            {calendarDays.map((day, index) => (
              <div
                key={index}
                onClick={() => selectDate(day)}
                className={`
                  p-2 text-center cursor-pointer rounded-lg transition-all duration-200
                  ${!day.isCurrentMonth ? 'text-gray-300' : 'text-gray-900'}
                  ${day.isToday ? 'bg-blue-100 border-2 border-blue-500' : ''}
                  ${day.isSelected ? 'bg-blue-600 text-white' : ''}
                  ${day.availableSlots.length > 0 && day.isCurrentMonth ? 'hover:bg-blue-50' : ''}
                  ${day.availableSlots.length === 0 && day.isCurrentMonth ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <div className="text-sm font-medium">{day.dayNumber}</div>
                {day.availableSlots.length > 0 && day.isCurrentMonth && (
                  <div className="flex justify-center mt-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Time Slots */}
          {selectedDate && (
            <div className="border-t pt-4">
              <h4 className="font-semibold mb-3">
                Available Times for {selectedDate.toLocaleDateString()}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {calendarDays
                  .find(day => day.date.toDateString() === selectedDate.toDateString())
                  ?.availableSlots.filter(slot => slot.available !== false).map((slot, index) => (
                    <Button
                      key={index}
                      variant={selectedTime === slot.time ? "default" : "outline"}
                      size="sm"
                      onClick={() => selectTimeSlot(slot.time, slot.doctor)}
                      disabled={!slot.available}
                      className="flex items-center gap-2"
                    >
                      <Clock className="w-3 h-3" />
                      {slot.time}
                      <span className="text-xs text-gray-500">{slot.doctor}</span>
                    </Button>
                  ))}
              </div>
              
              {/* Appointment Type Selection for Booking Mode */}
              {mode === 'book' && selectedDate && selectedTime && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
                  <h5 className="font-semibold text-green-900 mb-3">Select Appointment Type</h5>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                    {[
                      'General Consultation',
                      'Cancer Screening',
                      'Follow-up Appointment',
                      'Diagnostic Imaging',
                      'Lab Results Review',
                      'Emergency Consultation'
                    ].map((type) => (
                      <Button
                        key={type}
                        variant={selectedAppointmentType === type ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedAppointmentType(type)}
                        className="text-xs"
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                  
                  {selectedAppointmentType && (
                    <div className="space-y-4">
                      <div>
                        <h6 className="font-semibold text-green-800 mb-2">Select Medical Professional</h6>
                        <Select value={selectedDoctor} onValueChange={setSelectedDoctor}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Choose a medical professional" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableDoctors.map((professional: any) => (
                              <SelectItem key={professional.id} value={professional.name}>
                                <div className="flex items-center gap-2">
                                  {professional.role === 'radiologist' ? 
                                    <div className="w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs">R</div> :
                                    <Stethoscope className="w-4 h-4" />
                                  }
                                  <div>
                                    <div className="font-medium">{professional.name}</div>
                                    <div className="text-xs text-gray-500">
                                      {professional.role === 'radiologist' ? 'Radiologist' : 'Doctor'} - {professional.specialty}
                                    </div>
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedDoctor && (
                        <div className="flex items-center justify-between">
                          <div>
                            <h6 className="font-medium text-green-800">Ready to Book</h6>
                            <p className="text-sm text-green-700">
                              {selectedAppointmentType} with {selectedDoctor}
                              <br />
                              {selectedDate.toLocaleDateString()} at {selectedTime}
                            </p>
                          </div>
                          <Button 
                            onClick={handleBookAppointment}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Book Appointment
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              {/* One-Click Reschedule Button */}
              {mode === 'reschedule' && selectedDate && selectedTime && appointment && (
                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="font-semibold text-blue-900">Ready to Reschedule</h5>
                      <p className="text-sm text-blue-700">
                        Move appointment to {selectedDate.toLocaleDateString()} at {selectedTime}
                      </p>
                    </div>
                    <Button 
                      onClick={handleOneClickReschedule}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Confirm Reschedule
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <Stethoscope className="w-4 h-4 text-blue-600" />
              </div>
              {mode === 'book' ? 'Schedule New Appointment' : 'Reschedule Appointment'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Appointment Summary */}
            <div className="bg-gradient-to-r from-blue-50 to-green-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                  <CalendarIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 mb-1">
                    {mode === 'book' ? selectedAppointmentType : appointment?.type}
                  </h3>
                  <div className="space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      <span>Dr. {selectedDoctor || appointment?.doctor}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      <span>{selectedDate?.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{selectedTime}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Previous Appointment Info for Reschedule */}
            {mode === 'reschedule' && appointment && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800">Previous Appointment</span>
                </div>
                <p className="text-xs text-amber-700">
                  {new Date(appointment?.date).toLocaleDateString()} at {appointment?.time}
                </p>
              </div>
            )}

            {/* Important Notes */}
            <div className="bg-gray-50 rounded-lg p-3">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Important Notes:</h4>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>• Please arrive 15 minutes early</li>
                <li>• Bring a valid ID and insurance card</li>
                <li>• You'll receive a confirmation email</li>
                {mode === 'book' && selectedAppointmentType?.includes('Screening') && (
                  <li>• Fasting may be required - check your email</li>
                )}
              </ul>
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <Button 
                onClick={mode === 'book' ? confirmBooking : confirmReschedule}
                disabled={mode === 'book' ? bookAppointmentMutation.isPending : rescheduleAppointmentMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {mode === 'book' 
                  ? (bookAppointmentMutation.isPending ? 'Scheduling...' : 'Schedule Appointment')
                  : (rescheduleAppointmentMutation.isPending ? 'Rescheduling...' : 'Confirm Reschedule')
                }
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowConfirmation(false)}
                className="flex-1"
                disabled={mode === 'book' ? bookAppointmentMutation.isPending : rescheduleAppointmentMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}