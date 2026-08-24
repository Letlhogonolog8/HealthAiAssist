/**
 * A clinician booking an appointment for one of their patients.
 *
 * The Schedule tab used to render <AppointmentScheduler>, which is the
 * patient-facing booking wizard: "Book your appointment with our medical
 * professionals", "Select Professional Type — choose the type of medical
 * professional you'd like to see", and a list headed "Your appointments" that
 * queried /api/patient/appointments. A doctor does not book themselves a doctor,
 * and that list was empty for them no matter how full their diary was.
 *
 * This posts to POST /api/doctor/appointments/schedule, which takes a patientId
 * and answers 409 when the slot is already taken. The patient list comes from
 * the clinician's own panel, so they can only book for someone they actually
 * have a relationship with.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CalendarPlus, Loader2, Info } from 'lucide-react';
import { CLINIC_TIME_SLOTS } from '@shared/clinic-hours';

interface PanelPatient {
  id: number;
  name: string;
  email: string;
}

/** Today, as a local YYYY-MM-DD — not toISOString(), which shifts the date. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export default function DoctorScheduleAppointment({ user }: { user: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    patientId: '',
    appointmentDate: '',
    appointmentTime: '',
    type: 'Consultation',
    reason: '',
  });

  const { data: patients = [], isError: patientsError } = useQuery<PanelPatient[]>({
    queryKey: ['/api/doctor/patients'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/patients', { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Your patient panel could not be loaded (${response.status}).`);
      }
      return response.json();
    },
  });

  const schedule = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/doctor/appointments/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          response.status === 409
            ? 'That slot is already booked. Choose another time.'
            : detail?.error || `The appointment could not be created (${response.status}).`
        );
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Appointment scheduled', description: 'It is on your calendar.' });
      setForm({
        patientId: '',
        appointmentDate: '',
        appointmentTime: '',
        type: 'Consultation',
        reason: '',
      });
      // Every surface that counts or lists appointments.
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/upcoming'] });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/appointments/today'] });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/stats'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Not scheduled',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const complete = Boolean(
    form.patientId && form.appointmentDate && form.appointmentTime && form.type
  );

  return (
    <Card className="bg-slate-800 border-slate-600">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <CalendarPlus className="w-5 h-5" />
          Schedule an appointment
        </CardTitle>
        <CardDescription className="text-slate-400">
          For a patient on your panel. The server refuses a slot you have already
          booked.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          className="space-y-5 max-w-2xl"
          onSubmit={(event) => {
            event.preventDefault();
            if (complete && !schedule.isPending) schedule.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sched-patient" className="text-slate-200">
              Patient
            </Label>
            {patientsError ? (
              <p className="text-sm text-amber-400">
                Your patient panel could not be loaded, so there is nobody to choose.
                This is a connection problem, not an empty panel.
              </p>
            ) : patients.length === 0 ? (
              <p className="text-sm text-slate-400">
                No patients are linked to you yet. A patient appears here once they have
                an appointment or a scan assigned to you.
              </p>
            ) : (
              <Select
                value={form.patientId}
                onValueChange={(value) => setForm({ ...form, patientId: value })}
              >
                <SelectTrigger
                  id="sched-patient"
                  className="bg-slate-900 border-slate-600 text-white"
                >
                  <SelectValue placeholder="Choose a patient" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={String(patient.id)}>
                      {patient.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sched-date" className="text-slate-200">
                Date
              </Label>
              <Input
                id="sched-date"
                type="date"
                // No appointments in the past. The endpoint does not enforce this,
                // and a mistyped year is easy.
                min={todayLocal()}
                value={form.appointmentDate}
                onChange={(e) => setForm({ ...form, appointmentDate: e.target.value })}
                className="bg-slate-900 border-slate-600 text-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sched-time" className="text-slate-200">
                Time
              </Label>
              <Select
                value={form.appointmentTime}
                onValueChange={(value) => setForm({ ...form, appointmentTime: value })}
              >
                <SelectTrigger
                  id="sched-time"
                  className="bg-slate-900 border-slate-600 text-white"
                >
                  <SelectValue placeholder="Choose a time" />
                </SelectTrigger>
                <SelectContent>
                  {CLINIC_TIME_SLOTS.map((slot) => (
                    <SelectItem key={slot} value={slot}>
                      {slot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sched-type" className="text-slate-200">
              Type
            </Label>
            <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}>
              <SelectTrigger id="sched-type" className="bg-slate-900 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Consultation">Consultation</SelectItem>
                <SelectItem value="Follow-up">Follow-up</SelectItem>
                <SelectItem value="Results review">Results review</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sched-reason" className="text-slate-200">
              Reason <span className="text-slate-500">(optional)</span>
            </Label>
            <Textarea
              id="sched-reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="What this appointment is for"
              className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-600"
              rows={3}
            />
          </div>

          <div className="flex gap-2.5 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <p className="text-[13px] text-slate-400 leading-relaxed">
              The patient sees this on their own appointments tab. Nothing clinical is
              sent to them here — the reason above is a scheduling note, not a finding.
            </p>
          </div>

          <Button
            type="submit"
            disabled={!complete || schedule.isPending}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40"
          >
            {schedule.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Scheduling…
              </>
            ) : (
              'Schedule appointment'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
