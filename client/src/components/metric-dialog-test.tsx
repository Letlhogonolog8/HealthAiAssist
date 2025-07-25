import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function MetricDialogTest() {
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  
  const handleMetricClick = (metric: string) => {
    console.log('Opening dialog for:', metric);
    setSelectedMetric(metric);
  };
  
  const userMetrics = {
    admins: 1,
    radiologists: 1,
    doctors: 2,
    patients: 5,
    activeUsers: 3,
    newUsersToday: 2
  };
  
  const scanMetrics = {
    totalScans: 0,
    pendingScans: 0,
    completedToday: 0,
    cancerDetections: 0,
    averageProcessingTime: 2.3,
    aiConfidenceAverage: 94
  };
  
  return (
    <div className="p-6 bg-slate-900 min-h-screen">
      <h1 className="text-2xl font-bold text-white mb-6">Metric Dialog Test</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div 
          className="bg-slate-800 border border-slate-600 rounded-lg cursor-pointer hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition-all duration-300 relative p-6"
          onClick={() => handleMetricClick("Total Users")}
          style={{ cursor: 'pointer' }}
        >
          <div className="absolute top-2 right-2 text-xs text-blue-400 opacity-70">Click for details</div>
          <h2 className="text-sm font-medium text-blue-400">Total Users</h2>
          <p className="text-3xl font-bold text-white">
            {userMetrics.admins + userMetrics.radiologists + userMetrics.doctors + userMetrics.patients}
          </p>
          <p className="text-xs text-blue-300">+{userMetrics.newUsersToday} today</p>
        </div>
        
        <div 
          className="bg-slate-800 border border-slate-600 rounded-lg cursor-pointer hover:border-green-500 hover:shadow-lg hover:shadow-green-500/20 transition-all duration-300 relative p-6"
          onClick={() => handleMetricClick("Active Scans")}
          style={{ cursor: 'pointer' }}
        >
          <div className="absolute top-2 right-2 text-xs text-green-400 opacity-70">Click for details</div>
          <h2 className="text-sm font-medium text-green-400">Active Scans</h2>
          <p className="text-3xl font-bold text-white">{scanMetrics.pendingScans}</p>
          <p className="text-xs text-green-300">{scanMetrics.completedToday} completed today</p>
        </div>
      </div>
      
      {/* Dialog */}
      <Dialog 
        open={!!selectedMetric} 
        onOpenChange={(open) => !open && setSelectedMetric(null)}
      >
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-slate-800 border-slate-600 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">{selectedMetric} - Detailed Analysis</DialogTitle>
            <DialogDescription className="text-slate-400">
              Comprehensive system information and analytics
            </DialogDescription>
          </DialogHeader>
          
          {selectedMetric === "Total Users" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">User Demographics & Analytics</h3>
                <Badge variant="outline" className="bg-slate-700 text-slate-200">
                  {userMetrics.admins + userMetrics.radiologists + userMetrics.doctors + userMetrics.patients} total users
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="p-4 border border-slate-600 rounded-lg bg-slate-700">
                    <h4 className="font-medium mb-3 text-white">User Distribution by Role</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Patients</span>
                        <span className="text-sm font-medium text-white">{userMetrics.patients}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Doctors</span>
                        <span className="text-sm font-medium text-white">{userMetrics.doctors}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Radiologists</span>
                        <span className="text-sm font-medium text-white">{userMetrics.radiologists}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Administrators</span>
                        <span className="text-sm font-medium text-white">{userMetrics.admins}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="p-4 border border-slate-600 rounded-lg bg-slate-700">
                    <h4 className="font-medium mb-3 text-white">Activity Metrics</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Active Users</span>
                        <span className="text-sm font-medium text-white">{userMetrics.activeUsers}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">New Users Today</span>
                        <span className="text-sm font-medium text-white">{userMetrics.newUsersToday}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Login Rate</span>
                        <span className="text-sm font-medium text-white">85%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Avg Session Time</span>
                        <span className="text-sm font-medium text-white">24 min</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedMetric === "Active Scans" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Medical Scan Analytics</h3>
                <Badge variant="outline" className="bg-slate-700 text-slate-200">{scanMetrics.totalScans} total scans</Badge>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="p-4 border border-slate-600 rounded-lg bg-slate-700">
                    <h4 className="font-medium mb-3 text-white">Scan Status Distribution</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Pending Scans</span>
                        <span className="text-sm font-medium text-white">{scanMetrics.pendingScans}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Completed Today</span>
                        <span className="text-sm font-medium text-white">{scanMetrics.completedToday}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Cancer Detections</span>
                        <span className="text-sm font-medium text-white">{scanMetrics.cancerDetections}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Avg Processing Time</span>
                        <span className="text-sm font-medium text-white">{scanMetrics.averageProcessingTime}ms</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="p-4 border border-slate-600 rounded-lg bg-slate-700">
                    <h4 className="font-medium mb-3 text-white">Scan Type Analytics</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">Mammography</span>
                        <span className="text-sm font-medium text-white">45%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">CT Scans</span>
                        <span className="text-sm font-medium text-white">30%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">X-Rays</span>
                        <span className="text-sm font-medium text-white">20%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-300">MRI</span>
                        <span className="text-sm font-medium text-white">5%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div className="flex justify-end pt-4">
            <Button 
              variant="outline" 
              onClick={() => setSelectedMetric(null)} 
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}