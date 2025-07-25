import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";

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

export function StaffDialogFixed({
  isOpen,
  onOpenChange,
  onSubmit,
  isPending,
  title,
  description,
  role,
  buttonColor
}: AddStaffDialogProps) {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    fullName: '',
    email: '',
    specialization: '',
    licenseNumber: ''
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [usernameModifiedByUser, setUsernameModifiedByUser] = useState(false);

  // Generate username from full name
  const generateUsernameFromName = (fullName: string) => {
    if (!fullName) return '';
    const nameParts = fullName.toLowerCase().replace(/[^a-z\s]/g, '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts[nameParts.length - 1] || '';
    return `${firstName.substring(0, 1)}${lastName}`.substring(0, 15);
  };

  const updateField = (field: string, value: string) => {
    // Clear error for this field
    setErrors(prev => ({ ...prev, [field]: '' }));
    
    if (field === 'username') {
      setUsernameModifiedByUser(true);
      setFormData(prev => ({ ...prev, username: value }));
      return;
    }
    
    if (field === 'fullName') {
      const updatedData = { ...formData, fullName: value };
      
      if (!usernameModifiedByUser) {
        const generatedUsername = generateUsernameFromName(value);
        updatedData.username = generatedUsername;
      }
      
      setFormData(updatedData);
      return;
    }
    
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.username) newErrors.username = 'Username is required';
    if (!formData.password) newErrors.password = 'Password is required';
    if (!formData.fullName) newErrors.fullName = 'Full name is required';
    if (!formData.email) newErrors.email = 'Email is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submission attempt with data:', formData);
    
    if (!validateForm()) {
      console.error('Form validation failed:', errors);
      return;
    }
    
    console.log('Submitting staff form data:', formData);
    onSubmit(formData);
  };

  const resetForm = () => {
    setFormData({
      username: '',
      password: '',
      fullName: '',
      email: '',
      specialization: '',
      licenseNumber: ''
    });
    setErrors({});
    setUsernameModifiedByUser(false);
  };

  return (
    <Dialog 
      open={isOpen} 
      onOpenChange={(open) => {
        if (!open) resetForm();
        onOpenChange(open);
      }}
    >
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
              <Label htmlFor="username" className="text-white">Username*</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => updateField('username', e.target.value)}
                placeholder={`${role}_username`}
                className={`bg-slate-700 border-slate-600 text-white ${errors.username ? 'border-red-500' : ''}`}
              />
              {errors.username && (
                <div className="text-red-500 text-xs flex items-center mt-1">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {errors.username}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="password" className="text-white">Password*</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => updateField('password', e.target.value)}
                placeholder="Secure password"
                className={`bg-slate-700 border-slate-600 text-white ${errors.password ? 'border-red-500' : ''}`}
              />
              {errors.password && (
                <div className="text-red-500 text-xs flex items-center mt-1">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {errors.password}
                </div>
              )}
            </div>
          </div>
          
          <div>
            <Label htmlFor="fullName" className="text-white">Full Name*</Label>
            <Input
              id="fullName"
              value={formData.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              placeholder={role === 'doctor' ? "Dr. John Smith" : "Sarah Jones"}
              className={`bg-slate-700 border-slate-600 text-white ${errors.fullName ? 'border-red-500' : ''}`}
            />
            {errors.fullName && (
              <div className="text-red-500 text-xs flex items-center mt-1">
                <AlertCircle className="w-3 h-3 mr-1" />
                {errors.fullName}
              </div>
            )}
          </div>
          
          <div>
            <Label htmlFor="email" className="text-white">Email*</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder={`${role}@hospital.com`}
              className={`bg-slate-700 border-slate-600 text-white ${errors.email ? 'border-red-500' : ''}`}
            />
            {errors.email && (
              <div className="text-red-500 text-xs flex items-center mt-1">
                <AlertCircle className="w-3 h-3 mr-1" />
                {errors.email}
              </div>
            )}
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
              disabled={isPending}
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