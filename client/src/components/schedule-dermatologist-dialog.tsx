import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
 * What /api/dermatologists/nearby actually returns now.
 *
 * Nine of the previous fourteen fields did not exist in the database and were
 * generated per request by the server: `rating` was 4.5 + Math.random() * 0.5,
 * `distance` was a random number of miles that ignored the coordinates this
 * component sent, `coordinates` was the patient's own position with jitter added,
 * and `experience`, `location`, `address`, `hospitalAffiliation`, `nextAvailable`
 * and `isUrgentCare` were fixed strings. `phone` and `email` were real staff
 * contact details, served without authentication.
 *
 * `nextAvailable` survives because it is now looked up from the appointments
 * table rather than asserted, and it is null when the clinician has no free slot
 * in the next fortnight.
 */
interface Dermatologist {
  id: number;
  name: string;
  specialty: string;
  role: string;
  nextAvailable: { date: string; time: string } | null;
}

interface ProximityStatus {
  available: boolean;
  reason: string;
}

interface EmergencyGuidance {
  message: string;
  note: string;
}

interface ScheduleDermatologistDialogProps {
  scanResult: ScanResult;
  urgency: 'routine' | 'expedited' | 'urgent';
  triggerButton?: React.ReactNode;
}

export default function ScheduleDermatologistDialog({ scanResult, urgency }: ScheduleDermatologistDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [selectedDermatologist, setSelectedDermatologist] = useState<number | null>(null);
  const [appointmentReason, setAppointmentReason] = useState('');
  const [patientNotes, setPatientNotes] = useState('');
  const [shareAnalysis, setShareAnalysis] = useState(true);
  const [step, setStep] = useState(1); // 1: Select Doctor, 2: Choose Date/Time, 3: Confirm Details

  const { toast } = useToast();

  /**
   * Location is no longer collected.
   *
   * This component asked for the patient's precise coordinates on open, and when
   * the browser denied the request it fell back to hardcoded San Francisco
   * (37.7749, -122.4194) so the call would go through anyway. The coordinates
   * were POSTed to an endpoint that used them for one thing: jittering them back
   * out as invented clinician positions. Asking someone for their exact location
   * to power a feature that cannot use it is not defensible, so the prompt, the
   * state and the San Francisco fallback are all gone.
   */
  // Clinicians who can take a dermatology referral.
  const { data: dermatologyData, isLoading: loadingDocs } = useQuery({
    queryKey: ['/api/dermatologists/nearby', urgency],
    queryFn: async () => {
      const response = await fetch('/api/dermatologists/nearby', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urgency })
      });

      if (!response.ok) throw new Error('Failed to fetch dermatology clinicians');
      return response.json();
    },
    enabled: isOpen
  });

  const dermatologists: Dermatologist[] = dermatologyData?.dermatologists || [];
  const proximity: ProximityStatus | undefined = dermatologyData?.proximity;
  const emergencyGuidance: EmergencyGuidance | null = dermatologyData?.emergencyGuidance ?? null;

  /**
   * The clinician's real free slots for the chosen date.
   *
   * This used the default query function against
   * '/api/appointments/dermatologist-slots' with no parameters at all, and that
   * endpoint answered `timeSlots.filter(() => Math.random() > 0.3)` — a different
   * random subset on every render, for no particular clinician on no particular
   * date. A patient could pick a time that was never free, and nothing
   * downstream rechecked it.
   */
  const { data: availableSlots = [], isLoading: loadingSlots } = useQuery<string[]>({
    queryKey: ['/api/appointments/dermatologist-slots', selectedDermatologist, selectedDate],
    queryFn: async () => {
      if (!selectedDermatologist || !selectedDate) return [];
      const dateParam = format(selectedDate, 'yyyy-MM-dd');
      const response = await fetch(
        `/api/appointments/dermatologist-slots?doctorId=${selectedDermatologist}&date=${dateParam}`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Failed to load available times');
      return response.json();
    },
    enabled: !!(selectedDermatologist && selectedDate),
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
    onSuccess: (data) => {
      toast({
        title: "Appointment Scheduled",
        description: `Your dermatologist appointment has been confirmed for ${format(selectedDate!, 'PPP')} at ${selectedTime}.`,
      });
      setIsOpen(false);
      resetForm();
    },
    onError: (error) => {
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
    setAppointmentReason('');
    setPatientNotes('');
    setShareAnalysis(true);
  };

  // The effect that stood here called getCurrentLocation() on open. See the note
  // above: this dialog no longer asks for the patient's position.

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
      reason: appointmentReason || 'Skin lesion evaluation following AI analysis',
      notes: patientNotes,
      urgency,
      shareAnalysis,
      scanResult: shareAnalysis ? scanResult : null,
      appointmentType: 'dermatology_consultation'
    };

    scheduleAppointment.mutate(appointmentData);
  };

  const renderDermatologistSelection = () => (
    <div className="space-y-4 h-full flex flex-col">
      <div className="space-y-2 flex-shrink-0">
        <h3 className="text-lg font-semibold">Select a Dermatologist</h3>
        <p className="text-sm text-muted-foreground">
          {dermatologists.length > 0
            ? `${dermatologists.length} clinician${dermatologists.length === 1 ? '' : 's'} on this platform can take a dermatology referral:`
            : 'No clinician on this platform currently lists a dermatology specialisation.'}
        </p>
        {/*
          Replaces a line that read "Found N specialists near your location".
          Nothing was near anything: the server never used the coordinates this
          dialog sent, and had no clinician addresses to compare them against.
        */}
        {proximity && !proximity.available && (
          <p className="text-xs text-amber-600">{proximity.reason}</p>
        )}
      </div>

      <Alert className={`${urgencyInfo.color} flex-shrink-0`}>
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

      {/*
        This block rendered `nearbyHospitals`, two entirely fictional hospitals
        the server returned for urgent cases — "Main Medical Center" and
        "Regional Emergency Hospital" — with distances and, on a Call button
        wired straight to `tel:`, the numbers +1 (555) 100-2000 and
        +1 (555) 911-0000. A patient who had just been told their scan looked
        urgent was offered a one-tap call to a number reserved for fiction.

        This platform knows of no hospitals and cannot dispatch care. It says so,
        and points at real emergency services without inventing a number: the
        correct one depends on the country the patient is in, and a wrong
        emergency number is worse than none.
      */}
      {urgency === 'urgent' && emergencyGuidance && (
        <Card className="flex-shrink-0 border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-800">If this is an emergency</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            <p className="text-sm text-red-800">{emergencyGuidance.message}</p>
            <p className="text-xs text-red-600">{emergencyGuidance.note}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex-1 min-h-0">
        <div className="space-y-3 h-full overflow-y-auto scrollbar-thin pr-2">
          {loadingDocs ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : (
            dermatologists?.map((doctor: Dermatologist) => (
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
                        The rows that stood here rendered doctor.experience,
                        doctor.rating ("Rating: 4.87/5.0"), doctor.location,
                        doctor.distance ("1.4 miles"), doctor.address, doctor.phone
                        and doctor.email. The server generated the first four per
                        request — the rating and distance from Math.random() — and
                        the last two were real staff contact details on an
                        unauthenticated endpoint. None of them is stored anywhere,
                        so none of them is shown.
                      */}
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-4 w-4" />
                          {doctor.nextAvailable
                            ? `Next available: ${format(
                                new Date(`${doctor.nextAvailable.date}T00:00:00`),
                                'EEE d MMM'
                              )} at ${doctor.nextAvailable.time}`
                            : 'No free slot in the next two weeks'}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <div className="flex-shrink-0 pt-4 border-t">
        <Button 
          onClick={() => setStep(2)} 
          disabled={!selectedDermatologist}
          className="w-full"
        >
          Continue to Date Selection
        </Button>
      </div>
    </div>
  );

  const renderDateTimeSelection = () => (
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
            loadingSlots ? (
              <p className="text-sm text-muted-foreground p-4 border rounded-md">
                Checking this clinician's diary…
              </p>
            ) : availableSlots.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {availableSlots.map((slot: string) => (
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
              /*
                A real empty diary, distinguished from a loading one. The previous
                version rendered an empty grid silently, which looked identical to
                a day with no slots and to a failed request.
              */
              <p className="text-sm text-muted-foreground p-4 border rounded-md">
                No free times on this date. Try another day.
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground p-4 border rounded-md">
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
  );

  const renderConfirmation = () => {
    const selectedDoc = dermatologists?.find((d: Dermatologist) => d.id === selectedDermatologist);
    
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Confirm Appointment</h3>
          <Button variant="outline" size="sm" onClick={() => setStep(2)}>
            Back
          </Button>
        </div>

        {/* Appointment Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appointment Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium">Doctor:</p>
                <p>{selectedDoc?.name}</p>
              </div>
              <div>
                <p className="font-medium">Specialty:</p>
                <p>{selectedDoc?.specialty}</p>
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

        {/* Additional Details */}
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
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          className={`w-full ${
            urgency === 'urgent' 
              ? 'bg-red-600 hover:bg-red-700' 
              : urgency === 'expedited'
              ? 'bg-yellow-600 hover:bg-yellow-700'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
          onClick={() => {
            setIsOpen(true);
            setAppointmentReason('Skin lesion evaluation following AI analysis');
          }}
        >
          <CalendarIcon className="h-4 w-4 mr-2" />
          Schedule Dermatologist
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100 border-2 border-blue-300 shadow-xl" data-enhanced="v2">
        <DialogHeader className="flex-shrink-0 pb-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg -m-6 mb-6 p-6">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <div className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
              <CalendarIcon className="w-5 h-5" />
            </div>
            Schedule Dermatologist Consultation - Enhanced
          </DialogTitle>
          <DialogDescription className="text-blue-100 font-medium">
            Based on your skin analysis results, we recommend scheduling a consultation with a dermatologist.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          {step === 1 && renderDermatologistSelection()}
          {step === 2 && renderDateTimeSelection()}
          {step === 3 && renderConfirmation()}
        </div>
      </DialogContent>
    </Dialog>
  );
}