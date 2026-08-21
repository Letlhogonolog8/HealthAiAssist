/**
 * Whether the platform can reach a patient who is not looking at the tab.
 *
 * In-app notifications persist and push over the WebSocket, which is fine for a
 * clinician working in the application and useless for a patient who closed it
 * days ago. When no channel is configured, an urgent result waits in a bell
 * icon nobody is looking at.
 *
 * The server already reports this on /api/ready, and the delivery code already
 * refuses to pretend a message was sent. What was missing is that an
 * administrator had to know to curl a JSON endpoint to find out. A capability
 * this consequential should be visible where the system is administered.
 *
 * Stated as reach, not as configuration. "SENDGRID_API_KEY is unset" is a fact
 * about a variable; "no channel can reach a patient" is the same fact in terms
 * of what it costs.
 */
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Mail, MessageSquare } from 'lucide-react';

interface Readiness {
  notificationChannels?: { email: boolean; sms: boolean };
  encryption?: { configured: boolean; activeKeyId: string | null; keyCount: number };
}

export default function DeliveryReachPanel() {
  const { data, isLoading } = useQuery<Readiness>({
    queryKey: ['/api/ready'],
    queryFn: async () => {
      const res = await fetch('/api/ready', { credentials: 'include' });
      // 503 is a real answer here: the body still carries the channel status.
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return <p className="text-sm text-slate-400">Checking…</p>;

  const channels = data?.notificationChannels;
  const email = channels?.email ?? false;
  const sms = channels?.sms ?? false;
  const anyReach = email || sms;

  const rows: Array<{ key: string; label: string; on: boolean; icon: typeof Mail; missing: string }> = [
    {
      key: 'email',
      label: 'Email',
      on: email,
      icon: Mail,
      missing: 'Needs SENDGRID_API_KEY and NOTIFICATION_FROM_EMAIL, on a domain authenticated in SendGrid.',
    },
    {
      key: 'sms',
      label: 'SMS',
      on: sms,
      icon: MessageSquare,
      missing: 'Needs Twilio credentials and a sending number or alphanumeric sender id.',
    },
  ];

  return (
    <div className="space-y-3">
      <div
        className={`flex gap-3 rounded border p-3 ${
          anyReach
            ? 'border-emerald-700/60 bg-emerald-950/40'
            : 'border-amber-700/60 bg-amber-950/40'
        }`}
      >
        {anyReach ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        )}
        <p className={`text-xs ${anyReach ? 'text-emerald-100' : 'text-amber-100'}`}>
          {anyReach
            ? 'Results can reach a patient who is not signed in.'
            : 'No channel can reach a patient who is not signed in. Notifications are ' +
              'recorded and shown in the app, but a patient who has closed it will not ' +
              'learn that a result is ready.'}
        </p>
      </div>

      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-start justify-between gap-4 rounded border border-slate-700 bg-slate-900/40 p-3"
        >
          <div className="flex gap-2.5 min-w-0">
            <row.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-white text-sm">{row.label}</p>
              {!row.on && <p className="text-xs text-slate-400 mt-0.5">{row.missing}</p>}
            </div>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-1 font-mono text-xs uppercase tracking-wide ${
              row.on ? 'bg-emerald-900/50 text-emerald-200' : 'bg-slate-700 text-slate-300'
            }`}
          >
            {row.on ? 'reaching' : 'off'}
          </span>
        </div>
      ))}

      <p className="pt-1 text-xs text-slate-500">
        Delivered messages deliberately carry no clinical detail. Email and SMS are not
        confidential channels, and a lock-screen preview naming a diagnosis discloses it to
        whoever is holding the phone — so they say a result is ready and nothing about what
        it says.
      </p>
    </div>
  );
}
