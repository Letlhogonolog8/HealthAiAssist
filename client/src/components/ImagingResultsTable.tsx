import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Search, 
  Eye, 
  Download,
  ChevronLeft,
  ChevronRight,
  Brain,
  Calendar,
  Activity,
  Trash2
} from 'lucide-react';

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
}

interface ImagingResultsTableProps {
  results: ImagingResult[];
  onViewResult: (result: ImagingResult) => void;
  onDeleteResult?: (id: string) => void;
}

export default function ImagingResultsTable({ results, onViewResult, onDeleteResult }: ImagingResultsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-slate-100 dark:bg-slate-700 text-foreground';
    }
  };

  const filteredResults = results.filter(result => {
    const matchesSearch = result.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         result.scanType.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRisk = filterRisk === 'all' || result.riskLevel === filterRisk;
    return matchesSearch && matchesRisk;
  });

  const totalPages = Math.ceil(filteredResults.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedResults = filteredResults.slice(startIndex, startIndex + itemsPerPage);

  return (
    <Card className="shadow-lg border-0">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            Medical Imaging Results ({results.length})
          </CardTitle>
        </div>
        
        <div className="flex gap-4 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by patient or scan type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterRisk} onValueChange={setFilterRisk}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by Risk" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Levels</SelectItem>
              <SelectItem value="high">High Risk</SelectItem>
              <SelectItem value="medium">Medium Risk</SelectItem>
              <SelectItem value="low">Low Risk</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-semibold text-foreground">Patient</th>
                <th className="text-left p-4 font-semibold text-foreground">Scan Type</th>
                <th className="text-left p-4 font-semibold text-foreground">Date</th>
                <th className="text-left p-4 font-semibold text-foreground">Confidence</th>
                <th className="text-left p-4 font-semibold text-foreground">Risk Level</th>
                <th className="text-left p-4 font-semibold text-foreground">Finding</th>
                <th className="text-left p-4 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedResults.map((result, index) => (
                <tr key={result.id} className={`border-b hover:bg-gray-50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-25'}`}>
                  <td className="p-4">
                    <div className="font-medium text-foreground">{result.patientName}</div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-medium">{result.scanType.toUpperCase()}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      {new Date(result.analysisDate).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm font-semibold text-blue-600">
                      {result.confidence === null ? '—' : `${result.confidence}%`}
                    </div>
                  </td>
                  <td className="p-4">
                    <Badge className={`${getRiskColor(result.riskLevel ?? '')} text-xs font-medium`}>
                      {result.riskLevel ? result.riskLevel.toUpperCase() : 'NOT ASSESSED'}
                    </Badge>
                  </td>
                  <td className="p-4">
                    <div
                      className="text-sm text-foreground max-w-xs truncate"
                      title={result.primaryFinding ?? undefined}
                    >
                      {/* A scan still being read has no finding. Saying so beats
                          rendering an empty cell that reads as "nothing found". */}
                      {result.primaryFinding ?? 'Awaiting a clinician'}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => onViewResult(result)}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                      <Button variant="outline" size="sm">
                        <Download className="w-4 h-4" />
                      </Button>
                      {onDeleteResult && (
                        <Button 
                          onClick={() => onDeleteResult(result.id)}
                          variant="outline" 
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {paginatedResults.length === 0 && (
          <div className="text-center py-12">
            <Brain className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-muted-foreground mb-2">No Results Found</h3>
            <p className="text-muted-foreground">Try adjusting your search or filter criteria</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t bg-gray-50">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredResults.length)} of {filteredResults.length} results
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium px-3 py-1 bg-blue-100 text-blue-800 rounded">
                {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}