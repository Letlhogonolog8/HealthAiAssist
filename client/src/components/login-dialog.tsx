import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogIn, UserPlus, User, Stethoscope, Shield, Brain } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: (user: any) => void;
}

export default function LoginDialog({ open, onOpenChange, onLoginSuccess }: LoginDialogProps) {
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({ 
    username: "", 
    password: "", 
    fullName: "", 
    email: "", 
    role: "patient" 
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Login failed");
      return response.json();
    },
    onSuccess: (user) => {
      toast({
        title: "Login Successful",
        description: `Welcome back, ${user.fullName}!`,
      });
      onLoginSuccess(user);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: () => {
      toast({
        title: "Login Failed",
        description: "Invalid credentials. Please try again.",
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Registration failed");
      return response.json();
    },
    onSuccess: (user) => {
      toast({
        title: "Registration Successful",
        description: `Welcome to MedAI, ${user.fullName}!`,
      });
      onLoginSuccess(user);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: () => {
      toast({
        title: "Registration Failed",
        description: "Please check your information and try again.",
        variant: "destructive",
      });
    },
  });

  const [selectedRole, setSelectedRole] = useState<string>("");

  const roleIcons = {
    admin: Shield,
    radiologist: Brain,
    doctor: Stethoscope,
    patient: User,
  };

  const roleLoginOptions = [
    { role: "admin", name: "Administrator", description: "System management and analytics" },
    { role: "radiologist", name: "Radiologist", description: "AI-assisted image analysis" },
    { role: "doctor", name: "Doctor", description: "Patient management and diagnosis" },
  ];

  const handleRoleSelection = (role: string) => {
    setSelectedRole(role);
    // Clear any existing login data and focus on manual login
    setLoginData({ username: "", password: "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 border-slate-600 overflow-hidden flex flex-col shadow-2xl" aria-describedby="login-dialog-description">
        <DialogHeader className="flex-shrink-0 text-center py-6">
          <div className="flex items-center justify-center mb-4">
            <div className="p-3 bg-blue-600 rounded-full">
              <Shield className="w-8 h-8 text-white" />
            </div>
          </div>
          <DialogTitle className="text-2xl md:text-3xl text-white font-bold">Welcome to Health AI</DialogTitle>
          <p id="login-dialog-description" className="text-slate-300 text-base mt-2">
            Advanced AI-powered medical diagnosis platform
          </p>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-6">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-slate-700/50 mb-6 rounded-xl p-1">
              <TabsTrigger 
                value="login" 
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-300 rounded-lg py-3 font-semibold transition-all duration-200"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </TabsTrigger>
              <TabsTrigger 
                value="register" 
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-300 rounded-lg py-3 font-semibold transition-all duration-200"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Create Account
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="login" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Enhanced Role Selection */}
                <div className="space-y-6">
                  <div className="text-center lg:text-left">
                    <h3 className="text-xl font-bold text-white mb-2">Quick Access</h3>
                    <p className="text-slate-300">Choose your role for streamlined access</p>
                  </div>
                  <div className="space-y-4">
                    {roleLoginOptions.map((option) => {
                    const IconComponent = roleIcons[option.role as keyof typeof roleIcons];
                    return (
                      <Card key={option.role} className={`group bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 border-slate-600 hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/25 transition-all duration-300 cursor-pointer transform hover:scale-[1.02] ${
                        selectedRole === option.role ? 'border-blue-400 bg-gradient-to-r from-blue-900/40 via-slate-700 to-blue-900/40 shadow-lg shadow-blue-500/25' : ''
                      }`}
                            onClick={() => handleRoleSelection(option.role)}>
                        <CardContent className="p-5">
                          <div className="flex items-center space-x-4">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                              selectedRole === option.role ? 'bg-blue-500' : 'bg-blue-600 group-hover:bg-blue-500'
                            }`}>
                              <IconComponent className="w-6 h-6 text-white" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-semibold text-white text-lg group-hover:text-blue-100 transition-colors">{option.name}</h4>
                              <p className="text-slate-300 text-sm mt-1 leading-relaxed">{option.description}</p>
                              {option.role !== 'admin' && (
                                <div className="flex items-center mt-2">
                                  <div className="w-2 h-2 bg-amber-400 rounded-full mr-2"></div>
                                  <p className="text-xs text-amber-300 font-medium">Admin required for {option.role} account creation</p>
                                </div>
                              )}
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 transition-all ${
                              selectedRole === option.role ? 'border-blue-400 bg-blue-400' : 'border-slate-500 group-hover:border-blue-400'
                            }`}>
                              {selectedRole === option.role && (
                                <div className="w-full h-full rounded-full bg-blue-400 flex items-center justify-center">
                                  <div className="w-2 h-2 bg-white rounded-full"></div>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

                {/* Enhanced Manual Login */}
                <Card className="bg-gradient-to-br from-slate-800/80 to-slate-700/80 border-slate-600">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-xl font-bold text-white flex items-center">
                      <User className="w-5 h-5 mr-3 text-blue-400" />
                      Sign In to Your Account
                    </CardTitle>
                    <CardDescription className="text-slate-300">
                      Enter your credentials to access the medical platform
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="username" className="text-white font-medium flex items-center">
                        <User className="w-4 h-4 mr-2 text-blue-400" />
                        Username
                      </Label>
                      <Input
                        id="username"
                        value={loginData.username}
                        onChange={(e) => setLoginData({ ...loginData, username: e.target.value })}
                        className="bg-slate-700/50 border-slate-500 text-white placeholder:text-slate-400 focus:border-blue-400 focus:ring-blue-400/25 h-12 px-4 rounded-lg transition-all"
                        placeholder="Enter your username"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-white font-medium flex items-center">
                        <Shield className="w-4 h-4 mr-2 text-blue-400" />
                        Password
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={loginData.password}
                        onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                        className="bg-slate-700/50 border-slate-500 text-white placeholder:text-slate-400 focus:border-blue-400 focus:ring-blue-400/25 h-12 px-4 rounded-lg transition-all"
                        placeholder="Enter password"
                      />
                    </div>
                    <Button 
                      onClick={() => loginMutation.mutate(loginData)}
                      disabled={loginMutation.isPending || !loginData.username || !loginData.password}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
                    >
                      <LogIn className="w-5 h-5 mr-2" />
                      {loginMutation.isPending ? "Signing In..." : "Sign In"}
                    </Button>
                    <div className="text-center pt-3">
                      <Button 
                        variant="link" 
                        className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                        onClick={() => {
                          onOpenChange(false);
                          window.open('/forgot-password', '_blank');
                        }}
                      >
                        Forgot Password?
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          
          <TabsContent value="register" className="space-y-4">
            <Card className="bg-slate-800 border-slate-600">
              <CardHeader>
                <CardTitle className="text-white">Patient Registration</CardTitle>
                <CardDescription className="text-slate-400">
                  Create a new patient account to access MedAI services
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="reg-fullName" className="text-white">Full Name</Label>
                    <Input
                      id="reg-fullName"
                      value={registerData.fullName}
                      onChange={(e) => setRegisterData({ ...registerData, fullName: e.target.value })}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <Label htmlFor="reg-email" className="text-white">Email</Label>
                    <Input
                      id="reg-email"
                      type="email"
                      value={registerData.email}
                      onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="john@example.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="reg-username" className="text-white">Username</Label>
                    <Input
                      id="reg-username"
                      value={registerData.username}
                      onChange={(e) => setRegisterData({ ...registerData, username: e.target.value })}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="johndoe"
                    />
                  </div>
                  <div>
                    <Label htmlFor="reg-password" className="text-white">Password</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      value={registerData.password}
                      onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                      className="bg-slate-700 border-slate-600 text-white"
                      placeholder="Enter password"
                    />
                  </div>
                </div>
                <Button 
                  onClick={() => registerMutation.mutate(registerData)}
                  disabled={registerMutation.isPending || !registerData.username || !registerData.password || !registerData.fullName || !registerData.email}
                  className="w-full bg-green-600 hover:bg-green-500"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  {registerMutation.isPending ? "Creating Account..." : "Create Account"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}