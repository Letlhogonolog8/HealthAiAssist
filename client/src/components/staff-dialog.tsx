import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";
import { useStaffForm } from "@/hooks/use-staff-form";

interface AddStaffDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
  title: string;
  description: string;
  role: 'doctor' | 'radiologist';
  buttonColor: string;
}

export function StaffDialog({
  isOpen,
  onOpenChange,
  onSubmit,
  isPending,
  title,
  description,
  role,
  buttonColor
}: AddStaffDialogProps) {
  const { formData, updateField, resetForm } = useStaffForm({
    username: '',
    password: '',
    fullName: '',
    email: '',
    specialization: '',
    licenseNumber: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submission attempt with data:', formData);
    if (!formData.username || !formData.password || !formData.fullName || !formData.email) {
      console.error('Missing required fields:', { formData });
      return; // Form validation should be handled by the parent component
    }
    console.log('Submitting staff form data:', formData);
    onSubmit(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-slate-800 border-slate-600">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {description}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="username" className="text-white">Username</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => updateField('username', e.target.value)}
                placeholder={`${role}_username`}
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            <div>
              <Label htmlFor="password" className="text-white">Password</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => updateField('password', e.target.value)}
                placeholder="Secure password"
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
          </div>
          
          <div>
            <Label htmlFor="fullName" className="text-white">Full Name</Label>
            <Input
              id="fullName"
              value={formData.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              placeholder={role === 'doctor' ? "Dr. John Smith" : "Sarah Jones"}
              className="bg-slate-700 border-slate-600 text-white"
            />
          </div>
          
          <div>
            <Label htmlFor="email" className="text-white">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder={`${role}@hospital.com`}
              className="bg-slate-700 border-slate-600 text-white"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="specialization" className="text-white">Specialization</Label>
              <Input
                id="specialization"
                value={formData.specialization}
                onChange={(e) => updateField('specialization', e.target.value)}
                placeholder={role === 'doctor' ? "Oncology" : "Radiology"}
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
            <div>
              <Label htmlFor="licenseNumber" className="text-white">License Number</Label>
              <Input
                id="licenseNumber"
                value={formData.licenseNumber}
                onChange={(e) => updateField('licenseNumber', e.target.value)}
                placeholder={role === 'doctor' ? "MD123456" : "RAD123456"}
                className="bg-slate-700 border-slate-600 text-white"
              />
            </div>
          </div>
          
          <div className="flex gap-3">
            <Button 
              type="submit"
              disabled={isPending || !formData.username || !formData.password || !formData.fullName || !formData.email}
              className={`flex-1 ${buttonColor}`}
            >
              {isPending ? 'Creating...' : `Create ${role.charAt(0).toUpperCase() + role.slice(1)}`}
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => {
                resetForm();
                onOpenChange(false);
              }} 
              className="flex-1 border-slate-600 text-slate-300"
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}