/**
 * Where a patient actually decides whether a model may read their scan.
 *
 * The server gate landed before this did, which meant every scan took the
 * "no consent on record" path and nothing was ever analysed — correct
 * behaviour with no way to exercise the choice. This is the missing half.
 *
 * ── Why this looks unpersuasive ────────────────────────────────────────────
 *
 * Consent interfaces are usually built to be agreed to. This one is built to
 * be *decided*, which means giving up the patterns that raise acceptance:
 *
 *   - Nothing is pre-ticked. A default-on checkbox collects a click, not a
 *     decision, and POPIA s1 wants consent to be a "voluntary, specific and
 *     informed expression of will".
 *   - Decline is a real button of the same weight as Agree, not a grey link
 *     under the fold. If refusing is visibly harder than accepting, the
 *     acceptance is worth less.
 *   - The error rates are body text, not a "learn more" disclosure. A miss
 *     rate hidden behind an expander is a miss rate the person did not see,
 *     and it is the single fact that should drive the decision.
 *   - The consequence of declining is stated *before* the buttons, because
 *     the fear that saying no costs you care is exactly what would make a yes
 *     meaningless.
 *
 * The disclosure text itself is not written here. It comes from
 * /api/scans/analysis-disclosure so that the wording a person saw and the
 * version recorded against their grant cannot drift apart — a consent record
 * pointing at text the UI no longer shows is not evidence of anything.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface Disclosure {
  scope: string;
  version: string;
  disclosure: string[];
  revocable: boolean;
  humanReviewGuaranteed: boolean;
  note: string;
}

interface ConsentState {
  scope: string;
  granted: boolean;
  version: string | null;
  recordedAt: string | null;
}

export function useAiAnalysisConsent() {
  return useQuery<ConsentState>({
    queryKey: ['/api/scans/analysis-consent'],
    queryFn: () => apiRequest('/api/scans/analysis-consent'),
  });
}

export function AiAnalysisConsentDialog({
  open,
  onOpenChange,
  onDecided,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the recorded decision, so a caller can continue or stop. */
  onDecided?: (granted: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<boolean | null>(null);

  const { data: disclosure, isLoading } = useQuery<Disclosure>({
    queryKey: ['/api/scans/analysis-disclosure'],
    queryFn: () => apiRequest('/api/scans/analysis-disclosure'),
    enabled: open,
  });

  const record = useMutation({
    mutationFn: (granted: boolean) =>
      apiRequest('/api/scans/analysis-consent', 'POST', { granted }),
    onMutate: (granted: boolean) => setPending(granted),
    onSuccess: (_data, granted) => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['/api/scans/analysis-consent'] });
      toast({
        title: granted ? 'Automated analysis turned on' : 'Automated analysis turned off',
        description: granted
          ? 'A clinician still reviews every scan. You can change this at any time.'
          : 'Your scans will go straight to a clinician. You can change this at any time.',
      });
      onOpenChange(false);
      onDecided?.(granted);
    },
    onError: (error: any) => {
      setPending(null);
      // Deliberately not falling back to "assume yes" on a failed write. An
      // unrecorded decision is not a decision, and the server fails closed.
      toast({
        title: 'Your choice was not saved',
        description:
          (error?.message ?? 'The server did not respond.') +
          ' Nothing has changed. Please try again.',
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Before a computer looks at your scan</DialogTitle>
          <DialogDescription>
            Please read this and choose. There is no wrong answer.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !disclosure ? (
          <p className="py-6 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2 text-sm leading-relaxed">
              {disclosure.disclosure.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="select-none text-muted-foreground">
                    •
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {/* Stated last and set apart, because it is the point most likely
                to be doubted: that refusing is free. */}
            <p className="rounded-md border border-border bg-muted/50 p-3 text-sm">
              {disclosure.note}
            </p>

            <p className="text-xs text-muted-foreground">
              Version {disclosure.version}. Whatever you choose is recorded, and you can
              change it later.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {/* Equal weight, deliberately. Declining is not the secondary action. */}
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            disabled={record.isPending || isLoading}
            onClick={() => record.mutate(false)}
          >
            {pending === false ? 'Saving…' : 'No, send it straight to a clinician'}
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={record.isPending || isLoading}
            onClick={() => record.mutate(true)}
          >
            {pending === true ? 'Saving…' : 'Yes, run the automated check'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
