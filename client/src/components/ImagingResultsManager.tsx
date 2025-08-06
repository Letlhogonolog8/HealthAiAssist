import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LayoutGrid, Table } from 'lucide-react';
import ImagingResultsList from './ImagingResultsList';
import ImagingResultsTable from './ImagingResultsTable';

interface ImagingResult {
  id: string;
  patientName: string;
  scanType: string;
  analysisDate: string;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  primaryFinding: string;
  hasCancer: boolean;
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
        <div className="flex bg-gray-100 rounded-lg p-1">
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