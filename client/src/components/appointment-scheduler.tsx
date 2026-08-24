import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  User, 
  Stethoscope, 
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  UserCheck
} from 'lucide-react';
import { format } from 'date-fns';

interface MedicalProfessional {
  id: number;
  name: string;
  role: 'doctor' | 'radiologist';
  specialty: string;
  available: boolean;
  email: string;
}

interface TimeSlot {
  time: string;
  available: boolean;
  source: string;
}

interface AppointmentSchedulerProps {
  user: any;
  onClose?: () => void;
}

export default function AppointmentScheduler({ user, onClose }: AppointmentSchedulerProps) {
  const [step, setStep] = useState(1);
  const [selectedRole, setSelectedRole] = useState<'doctor' | 'radiologist' | ''>('');
  const [selectedProfessional, setSelectedProfessional] = useState<MedicalProfessional | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState('');
  const [appointmentType, setAppointmentType] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch available medical professionals
  const { data: medicalProfessionals, isLoading: loadingProfessionals } = useQuery({
    queryKey: ['/api/doctors/available'],
    queryFn: async () => {
      const response = await fetch('/api/doctors/available', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch medical professionals');
      return response.json();
    },
    enabled: !!selectedRole
  });

  // Fetch available time slots for selected date
  const { data: availableSlots, isLoading: loadingSlots } = useQuery({
    queryKey: ['/api/appointments/available-slots', selectedDate?.toISOString().split('T')[0]],
    queryFn: async () => {
      if (!selectedDate) return {};
      
      const year = selectedDate.getFullYear();
      const month = selectedDate.getMonth() + 1;
      
      const response = await fetch(`/api/appointments/available-slots?year=${year}&month=${month}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch available slots');
      const data = await response.json();
      
      const dateStr = selectedDate.toISOString().split('T')[0];
      return data[dateStr] || [];
    },
    enabled: !!selectedDate
  });

  // Book appointment mutation
  const bookAppointmentMutation = useMutation({
    mutationFn: async (appointmentData: any) => {
      const response = await fetch('/api/patient/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(appointmentData)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to book appointment');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Appointment Booked Successfully",
        description: `Your appointment with ${selectedProfessional?.name} has been scheduled for ${format(selectedDate!, 'PPP')} at ${selectedTime}. Google Calendar integration active - no conflicts detected.`,
      });
      
      // Reset form
      setStep(1);
      setSelectedRole('');
      setSelectedProfessional(null);
      setSelectedDate(undefined);
      setSelectedTime('');
      setAppointmentType('');
      setReason('');
      
      // Refresh appointments
      queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments'] });
      
      if (onClose) onClose();
    },
    onError: (error: any) => {
      const errorMessage = error.message || "Failed to book appointment. Please try again.";
      
      // Enhanced error handling for Google Calendar conflicts
      if (errorMessage.includes('Time slot not available') || errorMessage.includes('already booked')) {
        toast({
          title: "Time Slot Unavailable",
          description: errorMessage.includes('Conflict:') ? 
            errorMessage : 
            "This time slot conflicts with an existing calendar event. Please select a different time.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Booking Failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    }
  });

  const handleSubmit = async () => {
    if (!selectedProfessional || !selectedDate || !selectedTime || !appointmentType || !reason) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    const appointmentData = {
      patientId: user.id,
      appointmentDate: selectedDate.toISOString().split('T')[0],
      appointmentTime: selectedTime,
      type: appointmentType,
      doctorName: selectedProfessional.name,
      reason: reason,
      status: 'scheduled'
    };

    try {
      await bookAppointmentMutation.mutateAsync(appointmentData);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProfessionals = medicalProfessionals?.filter(
    (prof: MedicalProfessional) => prof.role === selectedRole
  ) || [];

  const appointmentTypes = [
    'General Consultation',
    'Follow-up Visit',
    'Diagnostic Imaging',
    'Scan Review',
    'Second Opinion',
    'Urgent Consultation',
    'Routine Checkup',
    'Specialist Referral'
  ];

  /**
   * The appointments this patient already has.
   *
   * The tab showed only the booking wizard, so an existing appointment was
   * invisible here — the patient had to go back to the overview tile to learn
   * they had one.
   */
  const {
    data: myAppointments = [],
    isLoading: appointmentsLoading,
    isError: appointmentsError,
  } = useQuery<any[]>({
    queryKey: ['/api/patient/appointments'],
    queryFn: async () => {
      const response = await fetch('/api/patient/appointments', { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Your appointments could not be loaded (${response.status}).`);
      }
      return response.json();
    },
    enabled: Boolean(user?.id),
  });

  const now = Date.now();
  const upcoming = myAppointments
    .filter(
      (a: any) =>
        a.appointmentDate &&
        a.status !== 'cancelled' &&
        new Date(a.appointmentDate).getTime() >= now
    )
    .sort(
      (a: any, b: any) =>
        new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime()
    );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* ── What you already have booked ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5" />
            Your appointments
          </CardTitle>
          <CardDescription>
            {upcoming.length === 0
              ? 'Nothing scheduled.'
              : `${upcoming.length} upcoming`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appointmentsLoading ? (
            <p className="text-sm text-muted-foreground">Loading your appointments…</p>
          ) : appointmentsError ? (
            /* Distinguished from having none. Before this list existed the
               question did not arise; now an empty panel must not be able to
               mean "the request failed". */
            <p className="text-sm text-amber-600">
              Your appointments could not be loaded. This does not mean you have none —
              reload, or sign in again.
            </p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no upcoming appointments. Book one below.
            </p>
          ) : (
            <div className="space-y-3">
              {upcoming.map((appointment: any) => (
                <div
                  key={appointment.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {appointment.type || 'Consultation'}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {format(new Date(appointment.appointmentDate), 'EEEE d MMMM yyyy')}
                      {appointment.appointmentTime ? ` at ${appointment.appointmentTime}` : ''}
                    </p>
                    {appointment.doctorName && (
                      <p className="text-sm text-muted-foreground">
                        With {appointment.doctorName}
                      </p>
                    )}
                    {appointment.reason && (
                      <p className="text-xs text-muted-foreground mt-1">{appointment.reason}</p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      appointment.status === 'confirmed'
                        ? 'border-green-500 text-green-700 dark:text-green-400'
                        : 'border-slate-400 text-muted-foreground'
                    }
                  >
                    {appointment.status || 'scheduled'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Header */}
      <Card className="bg-gradient-to-r from-slate-700 to-slate-900 text-white">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CalendarIcon className="w-8 h-8" />
              <div>
                <CardTitle className="text-2xl">Schedule Appointment</CardTitle>
                <CardDescription className="text-slate-200">
                  Book your appointment with our medical professionals
                </CardDescription>
              </div>
            </div>
            {onClose && (
              <Button 
                variant="outline" 
                onClick={onClose}
                className="bg-white bg-opacity-20 hover:bg-opacity-30 text-white border-white border-opacity-30"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Progress Indicator */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            {[1, 2, 3, 4].map((stepNum) => (
              <div key={stepNum} className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                  step >= stepNum 
                    ? 'bg-slate-600 text-white' 
                    : 'bg-slate-200 text-slate-600'
                }`}>
                  {step > stepNum ? <CheckCircle className="w-5 h-5" /> : stepNum}
                </div>
                {stepNum < 4 && (
                  <div className={`w-16 h-1 mx-2 ${
                    step > stepNum ? 'bg-slate-600' : 'bg-slate-200'
                  }`} />
                )}
              </div>
            ))}
          </div>
          
          <div className="text-center">
            <p className="text-sm text-slate-600">
              Step {step} of 4: {
                step === 1 ? 'Select Professional Type' :
                step === 2 ? 'Choose Professional' :
                step === 3 ? 'Select Date & Time' :
                'Appointment Details'
              }
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Step 1: Select Professional Type */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Select Professional Type
            </CardTitle>
            <CardDescription>
              Choose the type of medical professional you'd like to see
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card 
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedRole === 'doctor' 
                    ? 'ring-2 ring-slate-600 bg-slate-50' 
                    : 'hover:bg-slate-50'
                }`}
                onClick={() => setSelectedRole('doctor')}
              >
                <CardContent className="p-6 text-center">
                  <Stethoscope className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                  <h3 className="text-lg font-semibold mb-2">Doctor</h3>
                  <p className="text-sm text-slate-600">
                    General consultations, follow-ups, and medical evaluations
                  </p>
                </CardContent>
              </Card>

              <Card 
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedRole === 'radiologist' 
                    ? 'ring-2 ring-slate-600 bg-slate-50' 
                    : 'hover:bg-slate-50'
                }`}
                onClick={() => setSelectedRole('radiologist')}
              >
                <CardContent className="p-6 text-center">
                  <UserCheck className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                  <h3 className="text-lg font-semibold mb-2">Radiologist</h3>
                  <p className="text-sm text-slate-600">
                    Medical imaging, scan reviews, and diagnostic consultations
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end pt-4">
              <Button 
                onClick={() => setStep(2)}
                disabled={!selectedRole}
                className="bg-slate-600 hover:bg-slate-700"
              >
                Next: Choose Professional
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Choose Professional */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5" />
              Choose {selectedRole === 'doctor' ? 'Doctor' : 'Radiologist'}
            </CardTitle>
            <CardDescription>
              Select from our available {selectedRole === 'doctor' ? 'doctors' : 'radiologists'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingProfessionals ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-20 bg-slate-200 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : filteredProfessionals.length > 0 ? (
              <div className="space-y-3">
                {filteredProfessionals.map((professional: MedicalProfessional) => (
                  <Card 
                    key={professional.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      selectedProfessional?.id === professional.id
                        ? 'ring-2 ring-slate-600 bg-slate-50'
                        : 'hover:bg-slate-50'
                    }`}
                    onClick={() => setSelectedProfessional(professional)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-slate-600 rounded-full flex items-center justify-center text-white font-semibold">
                            {professional.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div>
                            <h3 className="font-semibold text-slate-900">{professional.name}</h3>
                            <p className="text-sm text-slate-600">{professional.specialty}</p>
                            <p className="text-xs text-slate-500 capitalize">{professional.role}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            className={professional.available 
                              ? 'bg-green-100 text-green-800 border-green-300' 
                              : 'bg-red-100 text-red-800 border-red-300'
                            }
                          >
                            {professional.available ? 'Available' : 'Busy'}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-slate-400" />
                <p className="text-slate-600">No {selectedRole}s available at the moment</p>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button 
                variant="outline"
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button 
                onClick={() => setStep(3)}
                disabled={!selectedProfessional}
                className="bg-slate-600 hover:bg-slate-700"
              >
                Next: Select Date & Time
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Select Date & Time */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Select Date & Time
            </CardTitle>
            <CardDescription>
              Choose your preferred appointment date and available time slot
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Date Selection */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Appointment Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disabled={(date) => date < new Date() || date < new Date("1900-01-01")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Time Selection */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Available Time Slots</Label>
                {selectedDate ? (
                  loadingSlots ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-10 bg-slate-200 rounded animate-pulse" />
                      ))}
                    </div>
                  ) : availableSlots && availableSlots.length > 0 ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                        {availableSlots.map((slot: TimeSlot) => (
                          <Button
                            key={slot.time}
                            variant={selectedTime === slot.time ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedTime(slot.time)}
                            disabled={!slot.available}
                            className={selectedTime === slot.time ? "bg-slate-600 hover:bg-slate-700" : ""}
                          >
                            {slot.time}
                          </Button>
                        ))}
                      </div>
                      <div className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        Google Calendar integration active - conflicts filtered out
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-4 text-slate-600">
                      <Clock className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p>No available time slots for this date</p>
                      <p className="text-xs text-slate-500 mt-1">All slots may be booked or have calendar conflicts</p>
                    </div>
                  )
                ) : (
                  <div className="text-center py-4 text-slate-600">
                    <p>Please select a date first</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button 
                variant="outline"
                onClick={() => setStep(2)}
              >
                Back
              </Button>
              <Button 
                onClick={() => setStep(4)}
                disabled={!selectedDate || !selectedTime}
                className="bg-slate-600 hover:bg-slate-700"
              >
                Next: Appointment Details
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Appointment Details */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              Appointment Details
            </CardTitle>
            <CardDescription>
              Provide additional information about your appointment
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Appointment Summary */}
            <Card className="bg-slate-50">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3">Appointment Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Professional:</span>
                    <span className="font-medium">{selectedProfessional?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Specialty:</span>
                    <span className="font-medium">{selectedProfessional?.specialty}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Date:</span>
                    <span className="font-medium">{selectedDate ? format(selectedDate, "PPP") : ''}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Time:</span>
                    <span className="font-medium">{selectedTime}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Appointment Type */}
            <div>
              <Label htmlFor="appointmentType" className="text-sm font-medium mb-2 block">
                Appointment Type *
              </Label>
              <Select value={appointmentType} onValueChange={setAppointmentType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select appointment type" />
                </SelectTrigger>
                <SelectContent>
                  {appointmentTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reason for Visit */}
            <div>
              <Label htmlFor="reason" className="text-sm font-medium mb-2 block">
                Reason for Visit *
              </Label>
              <Textarea
                id="reason"
                placeholder="Please describe the reason for your visit, symptoms, or concerns..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>

            <div className="bg-slate-50 p-4 rounded-lg mb-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span>Google Calendar integration ensures no scheduling conflicts</span>
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button 
                variant="outline"
                onClick={() => setStep(3)}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={!appointmentType || !reason || isSubmitting}
                className="bg-slate-600 hover:bg-slate-700"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Checking calendar & booking...
                  </>
                ) : (
                  'Book Appointment'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}