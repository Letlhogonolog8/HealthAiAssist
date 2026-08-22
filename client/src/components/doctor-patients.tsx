import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Users,
  User,
  Search,
  Phone,
  Mail,
  Calendar,
  FileText,
  MessageSquare,
  AlertTriangle,
  Activity
} from 'lucide-react';

/**
 * The clinician's patient panel.
 *
 * The shape below is what /api/doctor/patients actually returns. It previously
 * carried `condition`, `status` ('stable' | 'follow-up' | 'critical') and
 * `riskLevel` ('low' | 'medium' | 'high'), and this component rendered all three
 * as prominent badges and as the three counters at the bottom of the page. None
 * of them was ever read from the database: the server wrote the literals
 * 'Regular checkup', 'stable' and 'low' onto every patient it returned, so this
 * screen told a doctor that their whole panel was stable and low risk, and the
 * "High Risk Patients" counter read 0 no matter what any scan had found.
 *
 * The fields are gone rather than defaulted. What remains is what the platform
 * records, and the one risk-like figure it can honestly produce —
 * `highestScanRisk`, the highest band any of this patient's *scans* carries — is
 * labelled as a scan finding, not as a description of the patient.
 */
interface Patient {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  age: number | null;
  gender: string | null;
  lastVisit: string | null;
  nextAppointment: string | null;
  scanCount: number;
  pendingScans: number;
  highestScanRisk: string | null;
  highestScanRiskAt: string | null;
}

const riskBadgeClass = (risk: string | null) => {
  switch ((risk ?? '').toLowerCase()) {
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'high':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'low':
      return 'bg-green-100 text-green-800 border-green-300';
    default:
      return 'bg-slate-100 text-slate-800 border-slate-300';
  }
};

/** A value the database does not hold renders as this, never as a plausible default. */
const orUnrecorded = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? 'Not recorded' : String(value);

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : 'None recorded';

export default function DoctorPatients({ user, onSectionChange }: { user: any; onSectionChange?: (section: string, data?: any) => void }) {
  const [searchTerm, setSearchTerm] = useState('');

  /**
   * A failed request is an error, not an empty panel.
   *
   * This used to `return []` on any non-OK response, so an expired session or a
   * failing database rendered as "0 patients" — a clinician cannot tell a panel
   * that is genuinely empty from one the server refused to send.
   */
  const { data: patients = [], isLoading, isError, error } = useQuery<Patient[]>({
    queryKey: ['/api/doctor/patients'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/patients', { credentials: 'include' });
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'You are not signed in, or this account cannot view a patient panel.'
            : `The patient list could not be loaded (${response.status}).`
        );
      }
      return response.json();
    },
    refetchInterval: 30000,
    retry: 1
  });

  const term = searchTerm.trim().toLowerCase();
  const filteredPatients = term
    ? patients.filter(patient => patient.name?.toLowerCase().includes(term))
    : patients;

  const withFlaggedScan = patients.filter(patient =>
    ['high', 'critical'].includes((patient.highestScanRisk ?? '').toLowerCase())
  ).length;
  const awaitingRead = patients.reduce((total, patient) => total + (patient.pendingScans ?? 0), 0);

  if (isError) {
    return (
      <Card className="bg-slate-800 border-red-800">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-300">Patient list unavailable</p>
              <p className="text-sm text-slate-300 mt-1">
                {(error as Error)?.message ?? 'The patient list could not be loaded.'}
              </p>
              <p className="text-sm text-slate-400 mt-2">
                This is not an empty panel — the list could not be read at all. Do not
                treat this screen as evidence that you have no patients.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Panel summary. Every figure is a count of rows, not a clinical judgement. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-white">{patients.length}</div>
            <div className="text-sm text-slate-300">Patients in your panel</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-orange-400">{withFlaggedScan}</div>
            <div className="text-sm text-slate-300">With a scan flagged high or critical</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{awaitingRead}</div>
            <div className="text-sm text-slate-300">Scans awaiting a read</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Users className="w-5 h-5" />
            Your Patients
          </CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search patients by name..."
              className="pl-9 bg-slate-700 border-slate-600 text-white"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-slate-400 py-6 text-center">Loading your panel…</p>
          ) : filteredPatients.length === 0 ? (
            <p className="text-slate-400 py-6 text-center">
              {patients.length === 0
                ? 'No patients are linked to you yet. A patient appears here once they have an appointment or a scan assigned to you.'
                : 'No patients match that search.'}
            </p>
          ) : (
            <div className="space-y-4">
              {filteredPatients.map((patient) => (
                <div key={patient.id} className="p-4 bg-slate-700 border border-slate-600 rounded-lg">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                          <User className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{patient.name}</h4>
                          <p className="text-sm text-slate-300">
                            {patient.age === null ? 'Age not recorded' : `${patient.age} years`}
                            {' • '}
                            {orUnrecorded(patient.gender)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-slate-400">Contact</span>
                          <div className="flex items-center gap-2 mt-1">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span className="text-slate-300">{orUnrecorded(patient.email)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span className="text-slate-300">{orUnrecorded(patient.phone)}</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-slate-400">On this platform</span>
                          <p className="text-slate-300 mt-1">
                            Last appointment with you: {formatDate(patient.lastVisit)}
                          </p>
                          <p className="text-slate-300">
                            Scans on file: {patient.scanCount}
                            {patient.pendingScans > 0 && (
                              <span className="text-blue-300"> ({patient.pendingScans} awaiting a read)</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {patient.nextAppointment && (
                        <div className="mt-3 p-2 bg-blue-900/20 rounded text-sm">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-blue-400" />
                            <span className="text-blue-300">
                              Next appointment: {new Date(patient.nextAppointment).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-3">
                      {/*
                        A scan finding, labelled as one. The badge this replaces
                        said "LOW RISK" about the patient, from a value the server
                        hardcoded.
                      */}
                      {patient.highestScanRisk ? (
                        <Badge className={riskBadgeClass(patient.highestScanRisk)}>
                          {patient.highestScanRisk.toUpperCase()} SCAN FINDING
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-100 text-slate-700 border-slate-300">
                          NO SCAN FINDING RECORDED
                        </Badge>
                      )}

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-slate-300 border-slate-500 hover:bg-slate-600"
                          onClick={() => onSectionChange?.('reports', { patientId: patient.id, patientName: patient.name })}
                        >
                          <FileText className="w-3 h-3 mr-1" />
                          Records
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-slate-300 border-slate-500 hover:bg-slate-600"
                          onClick={() => onSectionChange?.('chat', { patientId: patient.id, patientName: patient.name })}
                        >
                          <MessageSquare className="w-3 h-3 mr-1" />
                          Chat
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-slate-300 border-slate-500 hover:bg-slate-600"
                          onClick={() => onSectionChange?.('appointments', { patientId: patient.id, patientName: patient.name })}
                        >
                          <Calendar className="w-3 h-3 mr-1" />
                          Schedule
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        The "Risk Assessment Overview" card that stood here is gone.
        It counted patients by `riskLevel`, a field the server set to 'low' for
        everyone, so it always read "0 high risk, 0 medium risk, N low risk" and
        described that as an assessment. This platform does not assess patient
        risk; it flags individual scans, and those are summarised above and shown
        per patient with the scan they came from.
      */}
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Activity className="w-5 h-5" />
            About these figures
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-300 space-y-2">
          <p>
            A scan finding is the risk band the model assigned to one image, not an
            assessment of the patient. Every result on this platform requires a
            clinician's sign-off before it means anything.
          </p>
          <p>
            This panel lists patients who have an appointment with you or a scan
            assigned to you. It is not the full patient register.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
