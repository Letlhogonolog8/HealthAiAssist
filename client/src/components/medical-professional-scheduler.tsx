import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar, Clock, Stethoscope, Activity, User, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface MedicalProfessional {
  id: number;
  name: string;
  role: 'doctor' | 'radiologist';
  specialty: string;
  available: boolean;
  email: string;
}

interface AppointmentSlot {
  time: string;
  available: boolean;
  doctor: string;
  doctorId: number;
  role: string;
  specialty: string;
}

interface MedicalProfessionalSchedulerProps {
  user: any;
  onAppointmentBooked?: () => void;
}

export default function MedicalProfessionalScheduler({ user, onAppointmentBooked }: MedicalProfessionalSchedulerProps) {
  const [selectedProfessional, setSelectedProfessional] = useState<MedicalProfessional | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [appointmentType, setAppointmentType] = useState<string>('');
  const [selectedTab, setSelectedTab] = useState('doctors');

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all medical professionals
  const { data: allProfessionals = [], isLoading: professionalsLoading } = useQuery({
    queryKey: ['/api/doctors/available'],
    queryFn: async () => {
      const response = await fetch('/api/doctors/available', {
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });
      return response.json();
    }
  });

  // Fetch available appointment slots
  const { data: availableSlots = {}, isLoading: slotsLoading } = useQuery({
    queryKey: ['/api/appointments/available-slots', 2025, 6],
    queryFn: async () => {
      const response = await fetch('/api/appointments/available-slots?year=2025&month=6', {
        headers: { 'Accept': 'application/json' },
        credentials: 'include'
      });
      return response.json();
    }
  });

  // Book appointment mutation
  const bookAppointmentMutation = useMutation({
    mutationFn: async (appointmentData: any) => {
      const response = await fetch('/api/patient/appointments', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(appointmentData)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Failed to book appointment');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Appointment Booked Successfully",
        description: `Your appointment with ${data.appointment.doctorName} has been scheduled.`,
      });
      
      // Reset form
      setSelectedProfessional(null);
      setSelectedDate('');
      setSelectedTime('');
      setAppointmentType('');
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/appointments/available-slots'] });
      
      onAppointmentBooked?.();
    },
    onError: (error: any) => {
      toast({
        title: "Booking Failed",
        description: error.message || "Failed to book appointment.",
        variant: "destructive",
      });
    }
  });

  const doctors = allProfessionals.filter((p: MedicalProfessional) => p.role === 'doctor');
  const radiologists = allProfessionals.filter((p: MedicalProfessional) => p.role === 'radiologist');

  const handleBookAppointment = () => {
    if (!selectedProfessional || !selectedDate || !selectedTime || !appointmentType) {
      toast({
        title: "Missing Information",
        description: "Please fill in all appointment details.",
        variant: "destructive",
      });
      return;
    }

    bookAppointmentMutation.mutate({
      patientId: user.id,
      appointmentDate: selectedDate,
      appointmentTime: selectedTime,
      type: appointmentType,
      doctorName: selectedProfessional.name,
      status: 'scheduled',
      reason: `${appointmentType} appointment`
    });
  };

  const appointmentTypes = {
    doctor: [
      'General Consultation',
      'Cancer Screening',
      'Follow-up Appointment',
      'Lab Results Review',
      'Emergency Consultation',
      'Second Opinion'
    ],
    radiologist: [
      'Diagnostic Imaging',
      'CT Scan Review',
      'MRI Analysis',
      'X-Ray Interpretation',
      'Ultrasound Examination',
      'Image-Guided Procedure'
    ]
  };

  if (professionalsLoading || slotsLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Loading medical professionals...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Card className="bg-gradient-to-br from-orange-50 to-amber-100 border-2 border-orange-300 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-t-lg">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            Medical Professional Scheduler - Enhanced
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-2 bg-white border-2 border-blue-200 shadow-lg">
              <TabsTrigger value="doctors" className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4" />
                Doctors ({doctors.length})
              </TabsTrigger>
              <TabsTrigger value="radiologists" className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Radiologists ({radiologists.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="doctors" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {doctors.map((doctor: MedicalProfessional) => (
                  <Card 
                    key={doctor.id} 
                    className={`cursor-pointer transition-all border-2 ${
                      selectedProfessional?.id === doctor.id 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-slate-200 dark:border-slate-700 hover:border-blue-300'
                    }`}
                    onClick={() => setSelectedProfessional(doctor)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <Stethoscope className="w-5 h-5 text-blue-600" />
                        <div>
                          <h3 className="font-semibold">{doctor.name}</h3>
                          <p className="text-sm text-muted-foreground">{doctor.specialty}</p>
                        </div>
                      </div>
                      <Badge variant={doctor.available ? "default" : "secondary"}>
                        {doctor.available ? "Available" : "Busy"}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="radiologists" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {radiologists.map((radiologist: MedicalProfessional) => (
                  <Card 
                    key={radiologist.id} 
                    className={`cursor-pointer transition-all border-2 ${
                      selectedProfessional?.id === radiologist.id 
                        ? 'border-purple-500 bg-purple-50' 
                        : 'border-slate-200 dark:border-slate-700 hover:border-purple-300'
                    }`}
                    onClick={() => setSelectedProfessional(radiologist)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">R</div>
                        <div>
                          <h3 className="font-semibold">{radiologist.name}</h3>
                          <p className="text-sm text-muted-foreground">{radiologist.specialty}</p>
                        </div>
                      </div>
                      <Badge variant={radiologist.available ? "default" : "secondary"} className="bg-purple-100 text-purple-800">
                        {radiologist.available ? "Available" : "Busy"}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          {selectedProfessional && (
            <div className="mt-6 space-y-4">
              <Card className="border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="text-green-800 flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Selected: {selectedProfessional.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Appointment Type Selection */}
                  <div>
                    <h4 className="font-semibold mb-2">Select Appointment Type</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {appointmentTypes[selectedProfessional.role].map((type) => (
                        <Button
                          key={type}
                          variant={appointmentType === type ? "default" : "outline"}
                          size="sm"
                          onClick={() => setAppointmentType(type)}
                          className="text-xs"
                        >
                          {type}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Date and Time Selection */}
                  {appointmentType && (
                    <div className="space-y-4">
                      <h4 className="font-semibold">Available Appointments</h4>
                      <div className="grid gap-4">
                        {Object.entries(availableSlots).map(([date, slots]) => {
                          const professionalSlots = (slots as AppointmentSlot[]).filter(
                            slot => slot.doctorId === selectedProfessional.id
                          );
                          
                          if (professionalSlots.length === 0) return null;
                          
                          return (
                            <div key={date} className="border rounded-lg p-4">
                              <h5 className="font-medium mb-2">{new Date(date).toLocaleDateString()}</h5>
                              <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                                {professionalSlots.map((slot, index) => (
                                  <Button
                                    key={index}
                                    variant={selectedDate === date && selectedTime === slot.time ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => {
                                      setSelectedDate(date);
                                      setSelectedTime(slot.time);
                                    }}
                                    className="flex items-center gap-1"
                                  >
                                    <Clock className="w-3 h-3" />
                                    {slot.time}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Book Appointment Button */}
                  {selectedDate && selectedTime && appointmentType && (
                    <div className="bg-gradient-to-r from-green-50 to-emerald-100 p-6 rounded-xl border-2 border-green-300 shadow-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-bold text-green-800 text-lg flex items-center gap-2">
                            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                              <CheckCircle className="w-4 h-4 text-white" />
                            </div>
                            Ready to Book
                          </h4>
                          <p className="text-sm text-green-700 font-medium mt-2">
                            {appointmentType} with {selectedProfessional.name}
                            <br />
                            {new Date(selectedDate).toLocaleDateString()} at {selectedTime}
                          </p>
                        </div>
                        <Button 
                          onClick={handleBookAppointment}
                          disabled={bookAppointmentMutation.isPending}
                          className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white font-semibold py-3 px-6 shadow-lg transition-all duration-200 transform hover:scale-105"
                        >
                          {bookAppointmentMutation.isPending ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                              Booking...
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Book Appointment
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}