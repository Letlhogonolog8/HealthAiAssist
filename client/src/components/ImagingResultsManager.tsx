import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LayoutGrid, Table } from 'lucide-react';
import ImagingResultsList from './ImagingResultsList';
import ImagingResultsTable from './ImagingResultsTable';

/**
 * One analysed scan, as the imaging views receive it.
 *
 * `confidence`, `riskLevel` and `hasCancer` are nullable because the row they
 * come from can genuinely lack them: a scan queued for manual review has no
 * model output at all, and rows written before those columns existed have none
 * either. They were previously typed as required, which is why every caller
 * filled the gap with a literal — `scan.aiConfidence || '85%'` in the patient
 * portal, and a risk band re-derived in the browser by searching the finding text
 * for the word "cancer". Making absence representable is what removes the need
 * to invent a value for it.
 */
interface ImagingResult {
  id: string;
  patientName: string;
  scanType: string;
  analysisDate: string;
  /** Percent, or null when the scan recorded none. Never a default. */
  confidence: number | null;
  /** The band the model assigned, as stored. Null when no model ran. */
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | null;
  primaryFinding: string | null;
  /** The model's own call. Null means "no prediction", not "negative". */
  hasCancer: boolean | null;
  imageUrl?: string;
}

interface ImagingResultsManagerProps {
  results: ImagingResult[];
  onViewResult: (result: ImagingResult) => void;
  onDeleteResult?: (id: string) => void;
}

export default function ImagingResultsManager({ results, onViewResult, onDeleteResult }: ImagingResultsManagerProps) {
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  return (
    <div className="space-y-4">
      {/* View Toggle */}
      <div className="flex justify-end">
        <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1">
          <Button
            variant={viewMode === 'cards' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('cards')}
            className="flex items-center gap-2"
          >
            <LayoutGrid className="w-4 h-4" />
            Cards
          </Button>
          <Button
            variant={viewMode === 'table' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('table')}
            className="flex items-center gap-2"
          >
            <Table className="w-4 h-4" />
            Table
          </Button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'cards' ? (
        <ImagingResultsList 
          results={results} 
          onViewResult={onViewResult} 
          onDeleteResult={onDeleteResult} 
        />
      ) : (
        <ImagingResultsTable 
          results={results} 
          onViewResult={onViewResult}
          onDeleteResult={onDeleteResult} 
        />
      )}
    </div>
  );
}