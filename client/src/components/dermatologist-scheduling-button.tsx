import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Calendar as CalendarIcon, Clock, User, MapPin, AlertTriangle, CheckCircle, Phone, Mail } from "lucide-react";
import { format } from "date-fns";

interface ScanResult {
  hasCancer: boolean;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  findings: string[];
  recommendations: string[];
  analysis?: {
    lesionType: string;
    malignancyRisk: string;
    abcdeScore: {
      asymmetry: number;
      border: number;
      color: number;
      diameter: number;
      evolving: number;
      total: number;
    };
    urgency: string;
    followUpPeriod: string;
  };
}

/**
 * Matches what /api/dermatologists/available returns.
 *
 * The seven fields removed here — isUrgentCare, experience, rating, location,
 * nextAvailable, phone, email — were not columns on `users`. The server mapped
 * each through `d.field ?? default`, so every one resolved to '' or 0 for every
 * clinician. The endpoint also filtered on a role named 'dermatologist' that
 * does not exist in this system, so it returned an empty array regardless.
 */
interface Dermatologist {
  id: number;
  name: string;
  specialty: string;
  role: string;
}

interface DermatologistSchedulingButtonProps {
  scanResult: ScanResult;
  urgency: 'routine' | 'expedited' | 'urgent';
}

export default function DermatologistSchedulingButton({ scanResult, urgency }: DermatologistSchedulingButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [selectedDermatologist, setSelectedDermatologist] = useState<number | null>(null);
  const [appointmentReason, setAppointmentReason] = useState('Skin lesion evaluation following AI analysis');
  const [patientNotes, setPatientNotes] = useState('');
  const [shareAnalysis, setShareAnalysis] = useState(true);
  const [step, setStep] = useState(1);

  const { toast } = useToast();

  // Fetch available dermatologists
  const { data: dermatologists = [], isLoading: dermatologistsLoading } = useQuery<Dermatologist[]>({
    queryKey: ['/api/dermatologists/available'],
    queryFn: async () => {
      const response = await fetch('/api/dermatologists/available', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch dermatologists');
      return response.json();
    }
  });

  /**
   * Free times for the chosen clinician on the chosen date.
   *
   * This called /api/dermatologists/time-slots, which has never existed — no such
   * route is registered — so every request 404'd, the query threw, and the time
   * picker was permanently empty. It also passed no clinician, so even a
   * working endpoint could not have answered correctly.
   *
   * The date is formatted from the local calendar date rather than through
   * toISOString(), which converts to UTC first and therefore returns the previous
   * day for any user west of Greenwich after their local evening.
   */
  const { data: timeSlots = [], isLoading: timeSlotsLoading } = useQuery<string[]>({
    queryKey: ['/api/appointments/dermatologist-slots', selectedDermatologist, selectedDate],
    queryFn: async () => {
      if (!selectedDate || !selectedDermatologist) return [];
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const response = await fetch(
        `/api/appointments/dermatologist-slots?doctorId=${selectedDermatologist}&date=${dateStr}`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Failed to fetch time slots');
      return response.json();
    },
    enabled: !!(selectedDate && selectedDermatologist)
  });

  // Schedule appointment mutation
  const scheduleAppointment = useMutation({
    mutationFn: async (appointmentData: any) => {
      const response = await fetch('/api/appointments/dermatologist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointmentData),
      });
      
      if (!response.ok) {
        throw new Error('Failed to schedule appointment');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Appointment Scheduled",
        description: `Your dermatologist appointment has been confirmed for ${format(selectedDate!, 'PPP')} at ${selectedTime}.`,
      });
      setIsOpen(false);
      resetForm();
    },
    onError: () => {
      toast({
        title: "Scheduling Failed",
        description: "Unable to schedule appointment. Please try again or call directly.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setStep(1);
    setSelectedDate(undefined);
    setSelectedTime('');
    setSelectedDermatologist(null);
    setAppointmentReason('Skin lesion evaluation following AI analysis');
    setPatientNotes('');
    setShareAnalysis(true);
  };

  const getUrgencyDetails = () => {
    switch (urgency) {
      case 'urgent':
        return {
          color: 'bg-red-100 text-red-800 border-red-200',
          icon: <AlertTriangle className="h-4 w-4" />,
          message: 'Urgent consultation needed - high-risk findings detected',
          timeframe: 'Within 24-48 hours'
        };
      case 'expedited':
        return {
          color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
          icon: <Clock className="h-4 w-4" />,
          message: 'Expedited appointment recommended',
          timeframe: 'Within 1-2 weeks'
        };
      default:
        return {
          color: 'bg-green-100 text-green-800 border-green-200',
          icon: <CheckCircle className="h-4 w-4" />,
          message: 'Routine dermatological consultation',
          timeframe: 'Within 1-3 months'
        };
    }
  };

  const urgencyInfo = getUrgencyDetails();

  const handleSubmit = () => {
    if (!selectedDermatologist || !selectedDate || !selectedTime) {
      toast({
        title: "Missing Information",
        description: "Please select a dermatologist, date, and time.",
        variant: "destructive",
      });
      return;
    }

    const appointmentData = {
      dermatologistId: selectedDermatologist,
      date: selectedDate,
      time: selectedTime,
      reason: appointmentReason,
      notes: patientNotes,
      urgency,
      shareAnalysis,
      scanResult: shareAnalysis ? scanResult : null,
    };

    scheduleAppointment.mutate(appointmentData);
  };

  const handleOpenDialog = () => {
    setIsOpen(true);
    setStep(1);
    setAppointmentReason('Skin lesion evaluation following AI analysis');
  };

  return (
    <>
      <Button 
        onClick={handleOpenDialog}
        className={`w-full ${
          urgency === 'urgent' 
            ? 'bg-red-600 hover:bg-red-700' 
            : urgency === 'expedited'
            ? 'bg-yellow-600 hover:bg-yellow-700'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        <CalendarIcon className="h-4 w-4 mr-2" />
        Schedule Dermatologist
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schedule Dermatologist Consultation</DialogTitle>
            <DialogDescription>
              Based on your skin analysis results, we recommend scheduling a consultation with a dermatologist.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Select a Dermatologist</h3>
                  <p className="text-sm text-gray-600">
                    Based on your scan results, we recommend scheduling with one of these specialists:
                  </p>
                </div>

                <Alert className={urgencyInfo.color}>
                  <div className="flex items-center gap-2">
                    {urgencyInfo.icon}
                    <div>
                      <AlertDescription>
                        <strong>{urgencyInfo.message}</strong><br />
                        Recommended timeframe: {urgencyInfo.timeframe}
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {dermatologists.map((doctor) => (
                    <Card
                      key={doctor.id}
                      className={`cursor-pointer transition-all hover:shadow-md ${
                        selectedDermatologist === doctor.id ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                      }`}
                      onClick={() => setSelectedDermatologist(doctor.id)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold">{doctor.name}</h4>
                              <Badge variant="outline">{doctor.specialty}</Badge>
                            </div>
                            {/*
                              The rows removed here showed doctor.experience,
                              doctor.rating, doctor.location, doctor.nextAvailable,
                              doctor.phone and doctor.email. None of those is a
                              column on `users`, so the server read undefined for
                              each and substituted '' or 0 — every clinician
                              displayed "Rating: 0/5.0" with a blank address.
                              Nothing behind them ever existed to show.
                            */}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Button 
                  onClick={() => setStep(2)} 
                  disabled={!selectedDermatologist}
                  className="w-full"
                >
                  Continue to Date Selection
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Select Date & Time</h3>
                  <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                    Back
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label>Select Date</Label>
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disabled={(date) => 
                        date < new Date() || 
                        (urgency === 'urgent' && date > new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
                      }
                      className="rounded-md border"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label>Available Times</Label>
                    {selectedDate ? (
                      <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                        {timeSlots.map((slot) => (
                          <Button
                            key={slot}
                            variant={selectedTime === slot ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedTime(slot)}
                            className="justify-start"
                          >
                            {slot}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 p-4 border rounded-md">
                        Please select a date to view available times
                      </p>
                    )}
                  </div>
                </div>

                <Button 
                  onClick={() => setStep(3)} 
                  disabled={!selectedDate || !selectedTime}
                  className="w-full"
                >
                  Continue to Confirmation
                </Button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Confirm Appointment</h3>
                  <Button variant="outline" size="sm" onClick={() => setStep(2)}>
                    Back
                  </Button>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Appointment Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-medium">Doctor:</p>
                        <p>{dermatologists.find((d: Dermatologist) => d.id === selectedDermatologist)?.name}</p>
                      </div>
                      <div>
                        <p className="font-medium">Specialty:</p>
                        <p>{dermatologists.find((d: Dermatologist) => d.id === selectedDermatologist)?.specialty}</p>
                      </div>
                      <div>
                        <p className="font-medium">Date:</p>
                        <p>{selectedDate ? format(selectedDate, 'PPP') : ''}</p>
                      </div>
                      <div>
                        <p className="font-medium">Time:</p>
                        <p>{selectedTime}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="reason">Appointment Reason</Label>
                    <Input
                      id="reason"
                      value={appointmentReason}
                      onChange={(e) => setAppointmentReason(e.target.value)}
                      placeholder="Skin lesion evaluation following AI analysis"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Additional Notes (Optional)</Label>
                    <Textarea
                      id="notes"
                      value={patientNotes}
                      onChange={(e) => setPatientNotes(e.target.value)}
                      placeholder="Any additional symptoms, concerns, or questions..."
                      rows={3}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="share-analysis"
                      checked={shareAnalysis}
                      onCheckedChange={(checked) => setShareAnalysis(!!checked)}
                    />
                    <Label htmlFor="share-analysis" className="text-sm">
                      Share AI analysis results with dermatologist
                    </Label>
                  </div>

                </div>

                <Button 
                  onClick={handleSubmit}
                  disabled={scheduleAppointment.isPending}
                  className="w-full"
                >
                  {scheduleAppointment.isPending ? 'Scheduling...' : 'Confirm Appointment'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
