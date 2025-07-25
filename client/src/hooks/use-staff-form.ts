import { useState, useEffect } from 'react';

/**
 * Custom hook for handling form data with automatic username generation
 * @param initialData Initial form data
 * @returns Form data state and handlers
 */
export function useStaffForm<T extends { username: string; fullName: string }>(initialData: T) {
  const [formData, setFormData] = useState<T>(initialData);
  const [usernameModifiedByUser, setUsernameModifiedByUser] = useState(false);

  // Generate username from full name
  const generateUsernameFromName = (fullName: string) => {
    if (!fullName) return '';
    const nameParts = fullName.toLowerCase().replace(/[^a-z\s]/g, '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts[nameParts.length - 1] || '';
    return `${firstName.substring(0, 1)}${lastName}`.substring(0, 15);
  };

  // Update form data with a new field value
  const updateField = (field: keyof T, value: any) => {
    // If username field is being directly modified, mark it as modified by user
    if (field === 'username') {
      setUsernameModifiedByUser(true);
      setFormData(prev => ({ ...prev, [field]: value }));
      return;
    }
    
    // If fullName is being updated and username hasn't been modified by user, auto-generate username
    if (field === 'fullName') {
      const updatedData = { ...formData, [field]: value } as T;
      
      if (!usernameModifiedByUser) {
        const generatedUsername = generateUsernameFromName(value);
        updatedData.username = generatedUsername;
      }
      
      setFormData(updatedData);
      return;
    }
    
    // For all other fields, just update normally
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Reset form data and username modification state
  const resetForm = () => {
    setFormData(initialData);
    setUsernameModifiedByUser(false);
  };

  return {
    formData,
    updateField,
    resetForm,
    usernameModifiedByUser,
    setUsernameModifiedByUser
  };
}