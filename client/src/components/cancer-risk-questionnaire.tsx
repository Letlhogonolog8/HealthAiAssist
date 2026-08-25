import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Calendar, Stethoscope, CheckCircle, AlertCircle } from "lucide-react";

interface QuestionnaireProps {
  user: any;
  onAppointmentRecommended?: (recommendation: any) => void;
  onRequestTabChange?: (tab: string) => void;
}

interface QuestionnaireResponse {
  age: number;
  gender: string;
  familyHistory: string;
  smoking: string;
  symptoms: string[];
  exercise: string;
  diet: string;
  alcohol: string;
  medicalHistory: string[];
  currentMedications: string;
  occupation: string;
}

export default function CancerRiskQuestionnaire({ user, onAppointmentRecommended, onRequestTabChange }: QuestionnaireProps) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [responses, setResponses] = useState<QuestionnaireResponse>({
    // Was 30. A pre-filled age is a value the patient did not give, and the
    // form submits whatever is sitting in the box.
    age: 0,
    gender: '',
    familyHistory: '',
    smoking: '',
    symptoms: [],
    exercise: '',
    diet: '',
    alcohol: '',
    medicalHistory: [],
    currentMedications: '',
    occupation: ''
  });
  const [results, setResults] = useState<any>(null);
  const [showResults, setShowResults] = useState(false);
  const [showAppointmentDialog, setShowAppointmentDialog] = useState(false);

  const totalSteps = 5;
  const progress = (currentStep / totalSteps) * 100;

  const submitQuestionnaire = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/patient/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: data,
          // patientId is no longer sent. The endpoint is authenticated and takes
          // the patient from the session; accepting it from the body let a
          // questionnaire be attributed to someone else.
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to process questionnaire');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setResults(data);
      setShowResults(true);
      
      if (data.appointmentSuggestion?.recommended && onAppointmentRecommended) {
        onAppointmentRecommended(data.appointmentSuggestion);
      }
      
      // "Your cancer risk level is X" told the patient this was a clinical risk
      // estimate. It is a tally of their own answers, and the server now says so
      // in the payload; the wording here matches.
      toast({
        title: "Questionnaire complete",
        description: data.screening?.eligibleForScreening
          ? 'You meet published criteria for lung cancer screening. Speaking to a clinician is suggested.'
          : 'You do not currently meet published screening criteria. See the detail for what that does and does not mean.',
      });
    },
    onError: (error: any) => {
      toast({
        title: "Assessment Failed",
        description: error.message || "Failed to process your questionnaire. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      submitQuestionnaire.mutate(responses);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSymptomChange = (symptom: string, checked: boolean) => {
    setResponses(prev => ({
      ...prev,
      symptoms: checked 
        ? [...prev.symptoms, symptom]
        : prev.symptoms.filter(s => s !== symptom)
    }));
  };

  const handleMedicalHistoryChange = (condition: string, checked: boolean) => {
    setResponses(prev => ({
      ...prev,
      medicalHistory: checked 
        ? [...prev.medicalHistory, condition]
        : prev.medicalHistory.filter(c => c !== condition)
    }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return responses.age > 0 && responses.gender;
      case 2: return responses.familyHistory && responses.smoking;
      case 3: return true; // Symptoms are optional
      case 4: return responses.exercise && responses.diet && responses.alcohol;
      case 5: return true; // Medical history is optional
      default: return false;
    }
  };

  // getRiskColor and getRiskIcon are gone with the risk level they coloured.
  // Traffic-lighting an unvalidated tally is what made it read as a clinical
  // finding: a red badge saying HIGH is a verdict whatever the caption under it
  // says.

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="w-5 h-5" />
          {/* Was "Breast Cancer Risk Assessment Questionnaire". Nothing it asks
              is breast-specific — age, gender, family history, smoking,
              symptoms, exercise, diet, alcohol, medical history, medications,
              occupation — and this platform has no breast classifier at all, so
              naming breast cancer implied a screening capability that does not
              exist. */}
          Health and risk-factor questionnaire
        </CardTitle>
        <CardDescription>
          Records the history and lifestyle factors a clinician would ask about. 
          Your responses will help determine if you need additional screening or consultation.
        </CardDescription>
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Step {currentStep} of {totalSteps}</span>
            <span>{Math.round(progress)}% Complete</span>
          </div>
          <Progress value={progress} className="w-full" />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {currentStep === 1 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Basic Information</h3>
            
            <div className="space-y-2">
              <Label htmlFor="age">Age</Label>
              <Input
                id="age"
                type="number"
                value={responses.age || ''}
                onChange={(e) => setResponses(prev => ({ ...prev, age: parseInt(e.target.value) || 0 }))}
                placeholder="Enter your age"
                min="18"
                max="120"
              />
            </div>

            <div className="space-y-3">
              <Label>Gender</Label>
              <RadioGroup
                value={responses.gender}
                onValueChange={(value) => setResponses(prev => ({ ...prev, gender: value }))}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="male" id="male" />
                  <Label htmlFor="male">Male</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="female" id="female" />
                  <Label htmlFor="female">Female</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other">Other</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Family & Personal History</h3>
            
            <div className="space-y-3">
              <Label>Do you have a family history of cancer?</Label>
              <RadioGroup
                value={responses.familyHistory}
                onValueChange={(value) => setResponses(prev => ({ ...prev, familyHistory: value }))}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="yes" id="family-yes" />
                  <Label htmlFor="family-yes">Yes</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="no" id="family-no" />
                  <Label htmlFor="family-no">No</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="unknown" id="family-unknown" />
                  <Label htmlFor="family-unknown">Don't know</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>Smoking history</Label>
              <RadioGroup
                value={responses.smoking}
                onValueChange={(value) => setResponses(prev => ({ ...prev, smoking: value }))}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="never" id="smoke-never" />
                  <Label htmlFor="smoke-never">Never smoked</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="former" id="smoke-former" />
                  <Label htmlFor="smoke-former">Former smoker</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="current" id="smoke-current" />
                  <Label htmlFor="smoke-current">Current smoker</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Current Symptoms</h3>
            <p className="text-sm text-muted-foreground">Select any symptoms you've experienced recently:</p>
            
            <div className="grid grid-cols-2 gap-3">
              {[
                'unexplained weight loss',
                'persistent fatigue',
                'unusual lumps',
                'persistent cough',
                'changes in bowel habits',
                'unusual bleeding',
                'persistent pain',
                'skin changes',
                'difficulty swallowing',
                'persistent headaches'
              ].map((symptom) => (
                <div key={symptom} className="flex items-center space-x-2">
                  <Checkbox
                    id={symptom}
                    checked={responses.symptoms.includes(symptom)}
                    onCheckedChange={(checked) => handleSymptomChange(symptom, !!checked)}
                  />
                  <Label htmlFor={symptom} className="text-sm capitalize">
                    {symptom}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Lifestyle Factors</h3>
            
            <div className="space-y-3">
              <Label>How often do you exercise?</Label>
              <RadioGroup
                value={responses.exercise}
                onValueChange={(value) => setResponses(prev => ({ ...prev, exercise: value }))}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="daily" id="exercise-daily" />
                  <Label htmlFor="exercise-daily">Daily</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="weekly" id="exercise-weekly" />
                  <Label htmlFor="exercise-weekly">3-5 times per week</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="occasionally" id="exercise-occasionally" />
                  <Label htmlFor="exercise-occasionally">1-2 times per week</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="rarely" id="exercise-rarely" />
                  <Label htmlFor="exercise-rarely">Rarely or never</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>How would you describe your diet?</Label>
              <RadioGroup
                value={responses.diet}
                onValueChange={(value) => setResponses(prev => ({ ...prev, diet: value }))}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="excellent" id="diet-excellent" />
                  <Label htmlFor="diet-excellent">Excellent (lots of fruits/vegetables)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="good" id="diet-good" />
                  <Label htmlFor="diet-good">Good (balanced meals)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="fair" id="diet-fair" />
                  <Label htmlFor="diet-fair">Fair (some processed foods)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="poor" id="diet-poor" />
                  <Label htmlFor="diet-poor">Poor (mostly processed foods)</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>Alcohol consumption</Label>
              <RadioGroup
                value={responses.alcohol}
                onValueChange={(value) => setResponses(prev => ({ ...prev, alcohol: value }))}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="none" id="alcohol-none" />
                  <Label htmlFor="alcohol-none">None</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="light" id="alcohol-light" />
                  <Label htmlFor="alcohol-light">Light (1-2 drinks per week)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="moderate" id="alcohol-moderate" />
                  <Label htmlFor="alcohol-moderate">Moderate (3-7 drinks per week)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="heavy" id="alcohol-heavy" />
                  <Label htmlFor="alcohol-heavy">Heavy (8+ drinks per week)</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Medical History</h3>
            
            <div className="space-y-3">
              <Label>Previous medical conditions (select all that apply):</Label>
              <div className="grid grid-cols-1 gap-3">
                {[
                  'diabetes',
                  'high blood pressure',
                  'heart disease',
                  'autoimmune disorders',
                  'previous cancer',
                  'chronic infections',
                  'inflammatory conditions'
                ].map((condition) => (
                  <div key={condition} className="flex items-center space-x-2">
                    <Checkbox
                      id={condition}
                      checked={responses.medicalHistory.includes(condition)}
                      onCheckedChange={(checked) => handleMedicalHistoryChange(condition, !!checked)}
                    />
                    <Label htmlFor={condition} className="capitalize">
                      {condition}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="medications">Current medications (optional)</Label>
              <Input
                id="medications"
                value={responses.currentMedications}
                onChange={(e) => setResponses(prev => ({ ...prev, currentMedications: e.target.value }))}
                placeholder="List any current medications"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="occupation">Occupation (optional)</Label>
              <Input
                id="occupation"
                value={responses.occupation}
                onChange={(e) => setResponses(prev => ({ ...prev, occupation: e.target.value }))}
                placeholder="Your occupation"
              />
            </div>
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1}
          >
            Previous
          </Button>
          
          <Button
            onClick={handleNext}
            disabled={!canProceed() || submitQuestionnaire.isPending}
          >
            {submitQuestionnaire.isPending 
              ? 'Processing...' 
              : currentStep === totalSteps 
                ? 'Complete Assessment' 
                : 'Next'
            }
          </Button>
        </div>
      </CardContent>

      {/* Results Dialog */}
      <Dialog open={showResults}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-slate-500" />
              Screening criteria result
            </DialogTitle>
          </DialogHeader>
          
          {results && (
            <div className="space-y-6">
              {/* No score, no band, no risk level.
                  This dialog used to open with a coloured HIGH / MODERATE / LOW
                  badge and "Score: 11/18", produced by an additive tally with
                  hand-picked weights that had never been fitted to any outcome.
                  It now reports whether published criteria are met, and cites
                  them. */}
              <Alert className="border-2 border-slate-300 bg-slate-50 text-slate-900">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  This does not estimate your chance of having or developing cancer.
                  It checks your answers against published criteria for who benefits
                  from lung cancer screening.
                </AlertDescription>
              </Alert>

              <div
                className={`p-4 rounded-lg border-2 ${
                  results.screening?.eligibleForScreening
                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                    : 'border-slate-300 bg-slate-50 text-slate-800'
                }`}
              >
                <p className="font-semibold mb-1">
                  {results.screening?.eligibleForScreening
                    ? 'You meet published screening criteria'
                    : 'You do not currently meet published screening criteria'}
                </p>
                <p className="text-sm">{results.screening?.guidance}</p>
                {typeof results.screening?.packYears === 'number' && (
                  <p className="text-xs mt-2 opacity-80">
                    Smoking history: {results.screening.packYears.toFixed(1)} pack-years
                  </p>
                )}
              </div>

              {/* Each criterion, met or not, with the source. A rule the patient
                  can look up is the difference between a finding and an
                  assertion. */}
              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Criteria checked</h4>
                {(results.screening?.criteria ?? []).map((criterion: any) => (
                  <div key={criterion.name} className="rounded border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{criterion.name}</span>
                      <Badge variant={criterion.meets ? 'default' : 'outline'}>
                        {criterion.meets ? 'Met' : 'Not met'}
                      </Badge>
                    </div>
                    {criterion.unmet?.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        {criterion.unmet.map((reason: string, i: number) => (
                          <li key={i}>&middot; {reason}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1.5 text-[11px] text-muted-foreground italic">
                      {criterion.citation}
                    </p>
                  </div>
                ))}
              </div>

              {(results.factorsToDiscuss ?? []).length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Worth raising with a clinician</h4>
                  <ul className="space-y-2">
                    {results.factorsToDiscuss.map((factor: string, index: number) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                        {factor}
                      </li>
                    ))}
                  </ul>
                  {/* Listed, not ranked. Ordering these would imply a weighting
                      that nothing here supports. */}
                  <p className="text-xs text-muted-foreground">
                    These are listed, not ranked. They are recognised risk factors in
                    populations; none of them supports an individual estimate.
                  </p>
                </div>
              )}

              {results.appointmentSuggestion?.recommended && (
                <Alert className="border-2 border-amber-400 bg-amber-50 text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <p className="font-semibold">Speaking to a clinician is suggested</p>
                      <p className="text-sm">{results.appointmentSuggestion.reason}</p>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button onClick={() => setShowResults(false)} variant="outline">
                  Close
                </Button>
                {results.appointmentSuggestion?.recommended && (
                  <>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          Schedule Appointment
                        </Button>
                      </DialogTrigger>
                      <DialogContent aria-describedby={undefined}>
                        <DialogHeader>
                          <DialogTitle>Schedule Medical Appointment</DialogTitle>
                        </DialogHeader>
                        <p className="text-sm text-muted-foreground">
                          Based on your risk assessment, we recommend scheduling an appointment with a {results.appointmentSuggestion.specialization} specialist.
                        </p>
                        <Button onClick={() => {
                          setShowResults(false);
                          if (onRequestTabChange) {
                            onRequestTabChange('appointments');
                          }
                          toast({
                            title: "Appointment Booking",
                            description: "Redirecting to appointment scheduling...",
                          });
                        }}>
                          Continue to Booking
                        </Button>
                      </DialogContent>
                    </Dialog>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
