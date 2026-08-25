/**
 * The scans this device is holding until it has a connection.
 *
 * Deliberately visible rather than a silent background mechanism. A clinician
 * who photographed six lesions in a ward with no signal needs to be able to see
 * that six things are waiting and none of them has been looked at — and to see
 * it without having to trust that an invisible process is doing its job.
 *
 * Every string here is about transport. None of them is about findings, because
 * a queued scan has none: nothing has run.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { CloudOff, Cloud, Loader2, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import {
  type QueuedScan,
  listQueued,
  remove,
  flushQueue,
  onQueueChange,
  queueAvailable,
} from '@/lib/scan-queue';

/** Tracks connectivity as the browser reports it. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}

/** Live view of the queue. */
export function useScanQueue(): { scans: QueuedScan[]; refresh: () => void } {
  const [scans, setScans] = useState<QueuedScan[]>([]);

  const refresh = useCallback(() => {
    if (!queueAvailable()) return;
    listQueued()
      .then(setScans)
      .catch(() => setScans([]));
  }, []);

  useEffect(() => {
    refresh();
    return onQueueChange(refresh);
  }, [refresh]);

  return { scans, refresh };
}

function relative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function OfflineScanQueue() {
  const online = useOnline();
  const { scans } = useScanQueue();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

  // Nothing waiting and a working connection: no panel. A persistent "you are
  // online" banner is noise.
  if (scans.length === 0 && online) return null;

  const failed = scans.filter((scan) => scan.status === 'failed');
  const waiting = scans.filter((scan) => scan.status !== 'failed');

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await flushQueue();
      if (result.uploaded > 0) {
        toast({
          title: `${result.uploaded} scan${result.uploaded === 1 ? '' : 's'} uploaded`,
          description: 'Results will appear once a clinician has reviewed them.',
        });
      } else if (result.remaining > 0) {
        toast({
          title: 'Nothing uploaded',
          description: 'The connection is still not working. The scans are safe here.',
          variant: 'destructive',
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {online ? (
            <Cloud className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <CloudOff className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-medium text-sm text-white">
              {online
                ? `${scans.length} scan${scans.length === 1 ? '' : 's'} waiting to upload`
                : "You are offline"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {/* The load-bearing sentence in this component. */}
              {scans.length > 0
                ? 'Nothing has been analysed yet. These are held on this device and will upload when there is a connection.'
                : 'Scans you capture will be held on this device and uploaded when you are back online.'}
            </p>
          </div>
        </div>

        {online && waiting.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={sync}
            disabled={syncing}
            className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10 shrink-0"
          >
            {syncing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Uploading
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Upload now
              </>
            )}
          </Button>
        )}
      </div>

      {scans.length > 0 && (
        <ul className="space-y-1.5">
          {scans.map((scan) => (
            <li
              key={scan.id}
              className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white capitalize">{scan.scanType}</span>
                  <Badge
                    variant="outline"
                    className={
                      scan.status === 'failed'
                        ? 'border-red-500/40 text-red-300 text-[10px]'
                        : scan.status === 'uploading'
                          ? 'border-cyan-500/40 text-cyan-300 text-[10px]'
                          : 'border-slate-700 text-slate-400 text-[10px]'
                    }
                  >
                    {scan.status === 'failed'
                      ? 'Not accepted'
                      : scan.status === 'uploading'
                        ? 'Uploading'
                        : 'Waiting'}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 truncate">
                  Captured {relative(scan.capturedAt)}
                  {scan.lastError ? ` · ${scan.lastError}` : ''}
                </p>
              </div>

              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove(scan.id)}
                aria-label={`Discard queued ${scan.scanType} scan`}
                className="h-7 w-7 text-slate-500 hover:text-red-300 shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && (
        <div className="flex gap-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-200">
            {failed.length === 1 ? 'One scan was' : `${failed.length} scans were`} not
            accepted by the server and will not be retried automatically. Discard and
            recapture, or check the reason above.
          </p>
        </div>
      )}
    </div>
  );
}
