/**
 * Account security. Currently that means the second factor.
 *
 * Reached from the Settings button in the dashboard header — which until now had
 * no onClick at all and rendered a cog that did nothing when pressed. Same class
 * of defect as the tabs that rendered without a panel behind them: a control
 * that looks operable and is not.
 *
 * The enrolment flow is deliberately three explicit steps rather than one
 * screen. Recovery codes are shown exactly once and cannot be recovered
 * afterwards, so the user has to pass a checkpoint that says so before the
 * dialog will move on.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, ShieldAlert, Loader2, Copy, Check, AlertTriangle } from 'lucide-react';

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  enforced: boolean;
  enrolledAt: string | null;
  backupCodesRemaining: number;
}

interface EnrolmentOffer {
  otpauthUrl: string;
  qrDataUrl: string;
  backupCodes: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

export default function SecuritySettingsDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [offer, setOffer] = useState<EnrolmentOffer | null>(null);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);
  const [token, setToken] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: status, isLoading } = useQuery<MfaStatus>({
    queryKey: ['/api/auth/mfa/status'],
    queryFn: async () => {
      const response = await fetch('/api/auth/mfa/status', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not read security settings');
      return response.json();
    },
    enabled: open,
  });

  const reset = () => {
    setOffer(null);
    setCodesAcknowledged(false);
    setToken('');
    setDisableToken('');
    setCopied(false);
  };

  const enrolMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/mfa/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not start enrolment.'));
      return response.json() as Promise<EnrolmentOffer>;
    },
    onSuccess: (data) => setOffer(data),
    onError: (error: Error) =>
      toast({ title: 'Enrolment failed', description: error.message, variant: 'destructive' }),
  });

  const verifyMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await readError(response, 'That code was not accepted.'));
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Two-factor authentication enabled',
        description: 'You will be asked for a code the next time you sign in.',
      });
      reset();
      queryClient.invalidateQueries({ queryKey: ['/api/auth/mfa/status'] });
    },
    onError: (error: Error) => {
      setToken('');
      toast({ title: 'Could not verify', description: error.message, variant: 'destructive' });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not disable.'));
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Two-factor authentication disabled' });
      reset();
      queryClient.invalidateQueries({ queryKey: ['/api/auth/mfa/status'] });
    },
    onError: (error: Error) => {
      setDisableToken('');
      toast({ title: 'Could not disable', description: error.message, variant: 'destructive' });
    },
  });

  const copyCodes = async () => {
    if (!offer) return;
    try {
      await navigator.clipboard.writeText(offer.backupCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Select the codes and copy them manually.',
        variant: 'destructive',
      });
    }
  };

  const fieldClass =
    'bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-cyan-500/40';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-800 text-white max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            Account security
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            A second factor means a stolen password is not enough to reach patient records.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : !status ? (
          <p className="py-8 text-slate-400">Could not read security settings.</p>
        ) : (
          <div className="space-y-5">
            {/* ── Current state ── */}
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
              <div>
                <p className="font-medium text-sm">Two-factor authentication</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {status.enabled
                    ? `Enabled${status.enrolledAt ? ` on ${new Date(status.enrolledAt).toLocaleDateString()}` : ''} · ${status.backupCodesRemaining} recovery codes left`
                    : 'Not set up'}
                </p>
              </div>
              <Badge
                className={
                  status.enabled
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }
              >
                {status.enabled ? 'On' : 'Off'}
              </Badge>
            </div>

            {status.required && !status.enabled && (
              <Alert className="border-amber-500/30 bg-amber-500/10">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                <AlertDescription className="text-amber-200 text-sm">
                  Your role can read any patient record.{' '}
                  {status.enforced
                    ? 'Patient data is blocked until you set this up.'
                    : 'Setting this up is expected for clinical accounts.'}
                </AlertDescription>
              </Alert>
            )}

            {status.enabled && status.backupCodesRemaining === 0 && (
              <Alert className="border-amber-500/30 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <AlertDescription className="text-amber-200 text-sm">
                  You have no recovery codes left. If you lose your phone you will not be
                  able to sign in. Disable and re-enrol to generate a new set.
                </AlertDescription>
              </Alert>
            )}

            {/* ── Enrolment ── */}
            {!status.enabled && !offer && (
              <Button
                onClick={() => enrolMutation.mutate()}
                disabled={enrolMutation.isPending}
                className="w-full h-11 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
              >
                {enrolMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Preparing…
                  </>
                ) : (
                  'Set up two-factor authentication'
                )}
              </Button>
            )}

            {/* Step 1: recovery codes, before anything else.
                Shown first and gated behind an explicit acknowledgement, because
                this is the only moment they exist in readable form. A user who
                scans the QR, enters a code and closes the dialog has enabled a
                factor they cannot recover from. */}
            {offer && !codesAcknowledged && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">1. Save your recovery codes</p>
                  <p className="text-xs text-slate-400 mt-1">
                    These are shown once and cannot be retrieved later. Each works a single
                    time, and they are the only way in if you lose your phone.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-sm">
                  {offer.backupCodes.map((code) => (
                    <span key={code} className="text-cyan-300 tracking-wide">
                      {code}
                    </span>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={copyCodes}
                    className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-2" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-2" /> Copy codes
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setCodesAcknowledged(true)}
                    className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold"
                  >
                    I have saved them
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: scan and verify. */}
            {offer && codesAcknowledged && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (token.trim() && !verifyMutation.isPending) verifyMutation.mutate(token.trim());
                }}
              >
                <div>
                  <p className="text-sm font-medium">2. Scan with your authenticator app</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Google Authenticator, 1Password, Authy — any TOTP app.
                  </p>
                </div>

                <div className="flex justify-center rounded-lg border border-slate-800 bg-white p-3">
                  <img
                    src={offer.qrDataUrl}
                    alt="QR code for two-factor authentication setup"
                    className="w-40 h-40"
                  />
                </div>

                <details className="text-xs text-slate-400">
                  <summary className="cursor-pointer hover:text-slate-300">
                    Can't scan? Enter this key manually
                  </summary>
                  <code className="mt-2 block break-all rounded bg-slate-950 p-2 text-cyan-300">
                    {new URL(offer.otpauthUrl.replace('otpauth://', 'https://')).searchParams.get(
                      'secret'
                    )}
                  </code>
                </details>

                <div className="space-y-1.5">
                  <Label htmlFor="mfa-verify-token" className="text-sm text-slate-300">
                    3. Enter the 6-digit code it shows
                  </Label>
                  <Input
                    id="mfa-verify-token"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className={`${fieldClass} text-center font-mono tracking-[0.3em]`}
                    placeholder="000000"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={!token.trim() || verifyMutation.isPending}
                  className="w-full h-11 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold disabled:opacity-40"
                >
                  {verifyMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    'Turn on two-factor authentication'
                  )}
                </Button>
              </form>
            )}

            {/* ── Disabling ── */}
            {status.enabled && (
              <form
                className="space-y-3 border-t border-slate-800 pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (disableToken.trim() && !disableMutation.isPending) {
                    disableMutation.mutate(disableToken.trim());
                  }
                }}
              >
                <div>
                  <p className="text-sm font-medium">Turn it off</p>
                  <p className="text-xs text-slate-400 mt-1">
                    A current code is required. Being signed in is not enough — otherwise a
                    stolen session could remove the control that exists to make a stolen
                    session insufficient.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={disableToken}
                    onChange={(e) => setDisableToken(e.target.value)}
                    className={`${fieldClass} text-center font-mono tracking-[0.3em]`}
                    placeholder="000000"
                    aria-label="Authentication code to disable two-factor authentication"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={!disableToken.trim() || disableMutation.isPending}
                    className="border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    {disableMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Disable'
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
