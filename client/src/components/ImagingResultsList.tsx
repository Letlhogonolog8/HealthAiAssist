import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Search, 
  Filter, 
  Calendar, 
  Brain, 
  Eye, 
  Download,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal
} from 'lucide-react';

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

interface ImagingResultsListProps {
  results: ImagingResult[];
  onViewResult: (result: ImagingResult) => void;
  onDeleteResult?: (id: string) => void;
}

export default function ImagingResultsList({ results, onViewResult, onDeleteResult }: ImagingResultsListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [filterScanType, setFilterScanType] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'date' | 'confidence' | 'risk'>('date');
  const itemsPerPage = 6;

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const filteredAndSortedResults = useMemo(() => {
    let filtered = results.filter(result => {
      const matchesSearch = result.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           result.scanType.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           result.primaryFinding.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRisk = filterRisk === 'all' || result.riskLevel === filterRisk;
      const matchesScanType = filterScanType === 'all' || result.scanType.toLowerCase() === filterScanType.toLowerCase();
      
      return matchesSearch && matchesRisk && matchesScanType;
    });

    // Sort results
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime();
        case 'confidence':
          return b.confidence - a.confidence;
        case 'risk':
          const riskOrder = { high: 3, medium: 2, low: 1 };
          return riskOrder[b.riskLevel] - riskOrder[a.riskLevel];
        default:
          return 0;
      }
    });

    return filtered;
  }, [results, searchTerm, filterRisk, filterScanType, sortBy]);

  const totalPages = Math.ceil(filteredAndSortedResults.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedResults = filteredAndSortedResults.slice(startIndex, startIndex + itemsPerPage);

  const uniqueScanTypes = [...new Set(results.map(r => r.scanType))];

  return (
    <div className="space-y-6">
      {/* Header with Search and Filters */}
      <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Medical Imaging Results</h2>
              <p className="text-sm text-blue-600 font-medium">{results.length} total analyses</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by patient name, scan type, or findings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filters and Sort */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Select value={filterRisk} onValueChange={setFilterRisk}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by Risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk Levels</SelectItem>
                <SelectItem value="high">High Risk</SelectItem>
                <SelectItem value="medium">Medium Risk</SelectItem>
                <SelectItem value="low">Low Risk</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterScanType} onValueChange={setFilterScanType}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by Scan Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Scan Types</SelectItem>
                {uniqueScanTypes.map(type => (
                  <SelectItem key={type} value={type.toLowerCase()}>{type.toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={(value: 'date' | 'confidence' | 'risk') => setSortBy(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Latest First</SelectItem>
                <SelectItem value="confidence">Highest Confidence</SelectItem>
                <SelectItem value="risk">Highest Risk</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" onClick={() => {
              setSearchTerm('');
              setFilterRisk('all');
              setFilterScanType('all');
              setSortBy('date');
              setCurrentPage(1);
            }}>
              <Filter className="w-4 h-4 mr-2" />
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Grid */}
      {paginatedResults.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Brain className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-600 mb-2">No Results Found</h3>
            <p className="text-gray-500">Try adjusting your search or filter criteria</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {paginatedResults.map((result) => (
            <Card key={result.id} className="hover:shadow-xl transition-all duration-300 border-0 shadow-lg">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-800 truncate">{result.patientName}</h3>
                    <p className="text-sm text-gray-600">{result.scanType.toUpperCase()}</p>
                  </div>
                  <Badge className={`${getRiskColor(result.riskLevel)} text-xs`}>
                    {result.riskLevel.toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">{result.confidence}%</div>
                    <div className="text-xs text-gray-600">Confidence</div>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <div className="text-sm font-bold text-gray-800">{result.primaryFinding}</div>
                    <div className="text-xs text-gray-600">Finding</div>
                  </div>
                </div>

                {/* Analysis Date */}
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="w-4 h-4" />
                  <span>{new Date(result.analysisDate).toLocaleDateString()}</span>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button 
                    onClick={() => onViewResult(result)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                    size="sm"
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    View Details
                  </Button>
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4" />
                  </Button>
                  {onDeleteResult && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => onDeleteResult(result.id)}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredAndSortedResults.length)} of {filteredAndSortedResults.length} results
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}