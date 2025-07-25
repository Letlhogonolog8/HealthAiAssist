import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function useStaffMutations(
  setShowAddDoctorDialog: (show: boolean) => void,
  setShowAddRadiologistDialog: (show: boolean) => void,
  refetchFunctions: {
    refetchStats: () => void;
    refetchUsers: () => void;
    refetchScans: () => void;
    refetchActivities: () => void;
    refetchStaff: () => void;
  }
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { refetchStats, refetchUsers, refetchScans, refetchActivities, refetchStaff } = refetchFunctions;

  // Create doctor mutation
  const createDoctorMutation = useMutation({
    mutationFn: async (doctorData: any) => {
      console.log('Creating doctor with data:', doctorData);
      const response = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...doctorData,
          role: 'doctor'
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create doctor' }));
        throw new Error(errorData.error || 'Failed to create doctor');
      }
      
      const data = await response.json();
      console.log('Doctor created successfully:', data);
      return data;
    },
    onSuccess: (data) => {
      // Invalidate all relevant queries to refresh data immediately
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users/metrics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/homepage/statistics'] });
      
      // Refresh all data immediately
      refetchStats();
      refetchUsers();
      refetchScans();
      refetchActivities();
      refetchStaff();
      
      toast({
        title: "Doctor Created Successfully",
        description: `Dr. ${data.fullName || ''} has been added to the system.`,
      });
      setShowAddDoctorDialog(false);
    },
    onError: (error: any) => {
      const errorMessage = error.message || "An error occurred while creating the doctor account.";
      
      toast({
        title: "Failed to Create Doctor",
        description: errorMessage,
        variant: "destructive",
      });
    }
  });

  // Create radiologist mutation
  const createRadiologistMutation = useMutation({
    mutationFn: async (radiologistData: any) => {
      console.log('Creating radiologist with data:', radiologistData);
      const response = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...radiologistData,
          role: 'radiologist'
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to create radiologist' }));
        throw new Error(errorData.error || 'Failed to create radiologist');
      }
      
      const data = await response.json();
      console.log('Radiologist created successfully:', data);
      return data;
    },
    onSuccess: (data) => {
      // Invalidate all relevant queries to refresh data immediately
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users/metrics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/staff'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/homepage/statistics'] });
      
      // Refresh all data immediately
      refetchStats();
      refetchUsers();
      refetchScans();
      refetchActivities();
      refetchStaff();
      
      toast({
        title: "Radiologist Created Successfully",
        description: `${data.fullName || ''} has been added to the system.`,
      });
      setShowAddRadiologistDialog(false);
    },
    onError: (error: any) => {
      const errorMessage = error.message || "An error occurred while creating the radiologist account.";
      
      toast({
        title: "Failed to Create Radiologist",
        description: errorMessage,
        variant: "destructive",
      });
    }
  });

  return {
    createDoctorMutation,
    createRadiologistMutation
  };
}