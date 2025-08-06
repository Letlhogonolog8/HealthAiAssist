import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
  FileText, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  User,
  Brain,
  Download,
  Eye,
  TrendingUp
} from 'lucide-react';

interface Report {
  id: number;
  patientName: string;
  scanType: string;
  submittedAt: string;
  status: 'pending' | 'reviewed' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  findings?: string;
  radiologist?: string;
  aiConfidence?: string;
}

export default function DoctorReports({ user }: { user: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Enhanced mock reports data with more comprehensive information
  const mockReports: Report[] = [
    {
      id: 1,
      patientName: 'John Smith',
      scanType: 'Chest CT Scan',
      submittedAt: new Date(Date.now() - 2*60*60*1000).toISOString(),
      status: 'pending',
      priority: 'urgent',
      findings: 'Multiple pulmonary nodules identified in bilateral lung fields. Largest nodule measures 2.3cm in right upper lobe. Recommend immediate oncology consultation and PET scan for staging.',
      radiologist: 'Dr. Sarah Johnson, MD',
      aiConfidence: '94%'
    },
    {
      id: 2,
      patientName: 'Maria Rodriguez',
      scanType: 'Mammography with Tomosynthesis',
      submittedAt: new Date(Date.now() - 4*60*60*1000).toISOString(),
      status: 'reviewed',
      priority: 'high',
      findings: 'Suspicious mass in left breast at 2 o\'clock position, measuring 1.8cm. BI-RADS Category 4B. Recommend core needle biopsy within 48 hours.',
      radiologist: 'Dr. Emily Brown, MD',
      aiConfidence: '91%'
    },
    {
      id: 3,
      patientName: 'Robert Chen',
      scanType: 'Prostate MRI',
      submittedAt: new Date(Date.now() - 6*60*60*1000).toISOString(),
      status: 'completed',
      priority: 'medium',
      findings: 'PI-RADS 3 lesion in peripheral zone. PSA correlation recommended. Consider MRI-guided biopsy if PSA elevated.',
      radiologist: 'Dr. Michael Lee, MD',
      aiConfidence: '88%'
    },
    {
      id: 4,
      patientName: 'Jennifer Davis',
      scanType: 'Colonoscopy with Biopsy',
      submittedAt: new Date(Date.now() - 8*60*60*1000).toISOString(),
      status: 'completed',
      priority: 'low',
      findings: 'Two small polyps removed from sigmoid colon. Histopathology shows tubular adenomas with low-grade dysplasia. Recommend surveillance colonoscopy in 3 years.',
      radiologist: 'Dr. Amanda Wilson, MD',
      aiConfidence: '96%'
    },
    {
      id: 5,
      patientName: 'David Thompson',
      scanType: 'Skin Lesion Analysis',
      submittedAt: new Date(Date.now() - 12*60*60*1000).toISOString(),
      status: 'pending',
      priority: 'high',
      findings: 'Asymmetric pigmented lesion on back with irregular borders. Dermoscopy shows atypical network pattern. Urgent dermatology referral recommended.',
      radiologist: 'Dr. Lisa Park, MD',
      aiConfidence: '89%'
    },
    {
      id: 6,
      patientName: 'Susan Miller',
      scanType: 'Cervical Cancer Screening',
      submittedAt: new Date(Date.now() - 24*60*60*1000).toISOString(),
      status: 'completed',
      priority: 'low',
      findings: 'Normal cytology. HPV test negative. Recommend routine screening in 3 years as per guidelines.',
      radiologist: 'Dr. Karen White, MD',
      aiConfidence: '97%'
    }
  ];

  const { data: reports = [], isLoading: reportsLoading, error: reportsError } = useQuery<Report[]>({
    queryKey: ['/api/doctor/reports'],
    queryFn: async () => {
      const response = await fetch('/api/doctor/reports', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch reports');
      }
      return response.json();
    },
    retry: 1,
    refetchInterval: 30000
  });

  // Use mock data when there's an error or no data
  const displayReports = reportsError ? mockReports : reports;

  const approveReportMutation = useMutation({
    mutationFn: async ({ reportId }: { reportId: number }) => {
      const response = await fetch(`/api/doctor/reports/${reportId}/approve`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to approve report');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Report Approved",
        description: "The report has been approved successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/doctor/reports'] });
    }
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'text-red-500';
      case 'high': return 'text-orange-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-green-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'reviewed': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'completed': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Reports Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-white">{displayReports.length}</div>
            <div className="text-sm text-slate-300">Total Reports</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">
              {displayReports.filter(r => r.status === 'pending').length}
            </div>
            <div className="text-sm text-slate-300">Pending Review</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-400">
              {displayReports.filter(r => r.status === 'completed').length}
            </div>
            <div className="text-sm text-slate-300">Completed</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800 border-slate-600">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-400">
              {displayReports.filter(r => r.priority === 'urgent' || r.priority === 'high').length}
            </div>
            <div className="text-sm text-slate-300">High Priority</div>
          </CardContent>
        </Card>
      </div>

      {/* Reports List */}
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <FileText className="w-5 h-5" />
            Medical Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reportsError && (
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-600 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">Demo Mode - Server Unavailable</span>
              </div>
              <p className="text-xs text-yellow-300 mt-1">Showing sample data for demonstration purposes</p>
            </div>
          )}
          {reportsLoading ? (
            <div className="space-y-4">
              {[1,2,3].map(i => (
                <div key={i} className="h-32 bg-slate-700 rounded-lg animate-pulse"></div>
              ))}
            </div>
          ) : displayReports.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 mx-auto mb-4 text-slate-400" />
              <p className="text-slate-400 font-medium mb-2">No reports available</p>
              <p className="text-slate-500 text-sm">Reports will appear here when patients submit scans</p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayReports.map((report) => (
              <div key={report.id} className="p-4 bg-slate-700 border border-slate-600 rounded-lg">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <User className="w-5 h-5 text-blue-400" />
                      <h4 className="font-medium text-white">{report.patientName}</h4>
                      <Badge className={getStatusColor(report.status)}>
                        {report.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-300 mb-1">{report.scanType}</p>
                    <p className="text-xs text-slate-400">
                      Submitted: {new Date(report.submittedAt).toLocaleString()}
                    </p>
                    {report.radiologist && (
                      <p className="text-xs text-slate-400">
                        Radiologist: {report.radiologist}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-4 h-4 ${getPriorityColor(report.priority)}`} />
                    <span className={`text-sm font-medium ${getPriorityColor(report.priority)}`}>
                      {report.priority.toUpperCase()}
                    </span>
                  </div>
                </div>

                {report.findings && (
                  <div className="mb-3 p-4 bg-slate-600 rounded-lg border-l-4 border-blue-400">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-5 h-5 text-purple-400" />
                      <span className="font-semibold text-white">Clinical Findings & Recommendations:</span>
                    </div>
                    <p className="text-slate-200 leading-relaxed mb-3">{report.findings}</p>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-500">
                      {report.aiConfidence && (
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                          <span className="text-sm font-medium text-green-400">
                            AI Analysis Confidence: {report.aiConfidence}
                          </span>
                        </div>
                      )}
                      <div className="text-xs text-slate-400">
                        Report ID: #{report.id.toString().padStart(6, '0')}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="text-slate-300 border-slate-500 hover:bg-slate-600">
                    <Eye className="w-3 h-3 mr-1" />
                    View Full Report
                  </Button>
                  <Button size="sm" variant="outline" className="text-slate-300 border-slate-500 hover:bg-slate-600">
                    <Download className="w-3 h-3 mr-1" />
                    Download PDF
                  </Button>
                  <Button size="sm" variant="outline" className="text-slate-300 border-slate-500 hover:bg-slate-600">
                    <User className="w-3 h-3 mr-1" />
                    Contact Patient
                  </Button>
                  {report.status === 'pending' && (
                    <Button 
                      size="sm" 
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => approveReportMutation.mutate({ reportId: report.id })}
                      disabled={approveReportMutation.isPending}
                    >
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {approveReportMutation.isPending ? 'Approving...' : 'Approve Report'}
                    </Button>
                  )}
                  {report.status === 'reviewed' && (
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                      <Clock className="w-3 h-3 mr-1" />
                      Schedule Follow-up
                    </Button>
                  )}
                </div>
              </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="bg-slate-800 border-slate-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <TrendingUp className="w-5 h-5" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button variant="outline" className="h-16 flex flex-col gap-2 text-slate-300 border-slate-500">
              <FileText className="w-6 h-6" />
              <span className="text-sm">Generate Report</span>
            </Button>
            <Button variant="outline" className="h-16 flex flex-col gap-2 text-slate-300 border-slate-500">
              <CheckCircle className="w-6 h-6" />
              <span className="text-sm">Bulk Approve</span>
            </Button>
            <Button variant="outline" className="h-16 flex flex-col gap-2 text-slate-300 border-slate-500">
              <AlertTriangle className="w-6 h-6" />
              <span className="text-sm">Flag Critical</span>
            </Button>
            <Button variant="outline" className="h-16 flex flex-col gap-2 text-slate-300 border-slate-500">
              <TrendingUp className="w-6 h-6" />
              <span className="text-sm">View Analytics</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}