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

  // Use real data only
  const displayReports = reports;

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
          <CardTitle className="flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Medical Reports
            </div>
            <Badge variant="outline" className="text-blue-400 border-blue-400">
              {displayReports.length} reports
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reportsError && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-600 rounded-lg">
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">Error Loading Reports</span>
              </div>
              <p className="text-xs text-red-300 mt-1">Unable to fetch reports from server</p>
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
            <div>
              <div className="space-y-2">
                {displayReports.slice(0, 3).map((report) => (
                  <div key={report.id} className="p-3 bg-slate-700 border border-slate-600 rounded-lg">
                    <div className="flex justify-between items-center">
                      <div className="flex-1">
                        <p className="font-medium text-white text-sm">{report.patientName}</p>
                        <p className="text-xs text-slate-400">{report.scanType} • {new Date(report.submittedAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`text-xs px-2 py-1 ${
                          report.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                          report.priority === 'high' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {report.priority?.toUpperCase()}
                        </Badge>
                        {report.status === 'pending' && (
                          <Button 
                            size="sm" 
                            onClick={() => approveReportMutation.mutate({ reportId: report.id })}
                            disabled={approveReportMutation.isPending}
                            className="bg-green-600 hover:bg-green-700 text-xs px-2 py-1 h-6"
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Approve
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {displayReports.length > 3 && (
                <div className="mt-4 pt-3 border-t border-slate-600">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-slate-300 border-slate-600 hover:bg-slate-700"
                  >
                    View All {displayReports.length} Reports
                  </Button>
                </div>
              )}
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