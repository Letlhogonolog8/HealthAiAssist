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

interface Dermatologist {
  id: number;
  name: string;
  specialty: string;
  experience: string;
  rating: number;
  location: string;
  address?: string;
  distance?: string;
  phone: string;
  email: string;
  availableSlots: string[];
  nextAvailable: string;
  isUrgentCare: boolean;
  hospitalAffiliation?: string;
  coordinates?: { lat: number; lng: number };
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

  // Real-time location state
  const [userLocation, setUserLocation] = useState<{latitude: number, longitude: number} | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Get user's location when dialog opens
  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          setLocationError(null);
        },
        (error) => {
          console.error('Location error:', error);
          setLocationError('Unable to get your location. Showing general recommendations.');
          // Use default location (example: San Francisco)
          setUserLocation({ latitude: 37.7749, longitude: -122.4194 });
        }
      );
    } else {
      setLocationError('Location services not supported. Showing general recommendations.');
      setUserLocation({ latitude: 37.7749, longitude: -122.4194 });
    }
  };

  // Fetch real-time nearby dermatologists based on location
  const { data: dermatologyData, isLoading: loadingDocs, refetch: refetchDermatologists } = useQuery({
    queryKey: ['/api/dermatologists/nearby', userLocation],
    queryFn: async () => {
      if (!userLocation) return null;
      
      const response = await fetch('/api/dermatologists/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          urgency,
          scanResult
        })
      });
      
      if (!response.ok) throw new Error('Failed to fetch nearby dermatologists');
      return response.json();
    },
    enabled: isOpen && !!userLocation
  });

  const dermatologists = dermatologyData?.dermatologists || [];
  const nearbyHospitals = dermatologyData?.nearbyHospitals || [];

  // Fetch available time slots for selected date and doctor
  const { data: availableSlots = [] } = useQuery<string[]>({
    queryKey: ['/api/appointments/dermatologist-slots', selectedDermatologist, selectedDate],
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

  // Get location when dialog opens
  React.useEffect(() => {
    if (isOpen && !userLocation) {
      getCurrentLocation();
    }
  }, [isOpen]);

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
        <p className="text-sm text-gray-600">
          {userLocation ? 
            `Found ${dermatologists.length} specialists near your location:` :
            'Based on your scan results, we recommend scheduling with these specialists:'
          }
        </p>
        {locationError && (
          <p className="text-xs text-amber-600">{locationError}</p>
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

      {/* Show nearby hospitals for urgent cases */}
      {urgency === 'urgent' && nearbyHospitals.length > 0 && (
        <Card className="flex-shrink-0 border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-800">Emergency Options</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {nearbyHospitals.map((hospital: any, index: number) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-red-800">{hospital.name}</p>
                    <p className="text-red-600">{hospital.distance} • {hospital.type}</p>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="text-red-600 border-red-300"
                    onClick={() => window.open(`tel:${hospital.phone}`)}
                  >
                    Call
                  </Button>
                </div>
              ))}
            </div>
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
                        {doctor.isUrgentCare && (
                          <Badge className="bg-red-100 text-red-800">Urgent Care</Badge>
                        )}
                        <Badge variant="outline">{doctor.specialty}</Badge>
                      </div>
                      
                      <div className="text-sm text-gray-600 space-y-1">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          {doctor.experience} • Rating: {doctor.rating}/5.0
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          {doctor.location}
                          {doctor.distance && <Badge variant="outline" className="ml-2 text-xs">{doctor.distance}</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-4 w-4" />
                          Next available: {doctor.nextAvailable}
                        </div>
                        {doctor.address && (
                          <p className="text-xs text-gray-500">{doctor.address}</p>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {doctor.phone}
                        </div>
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {doctor.email}
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
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {availableSlots?.map((slot: string) => (
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
      
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-4">
          <DialogTitle>Schedule Dermatologist Consultation</DialogTitle>
          <DialogDescription>
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