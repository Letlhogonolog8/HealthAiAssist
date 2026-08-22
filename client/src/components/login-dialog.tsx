/**
 * Sign in and patient registration.
 *
 * ── What was broken ────────────────────────────────────────────────────────
 *
 * A "Quick Access" panel occupied half the dialog, listing Administrator,
 * Radiologist and Doctor as pickable cards. Choosing one did two things:
 * recorded the choice in state that nothing ever read, and called
 * `setLoginData({ username: "", password: "" })`. The role was never sent —
 * `loginMutation` posts only username and password, and the server derives the
 * role from the account. So the panel could not affect the outcome of a login,
 * and it *erased whatever the user had already typed*. Someone who filled in
 * their username, then clicked the role matching their job, silently lost it.
 *
 * It also carried "Admin required for radiologist account creation" under each
 * card — a note about creating accounts, displayed on the sign-in tab, where
 * nobody is creating one.
 *
 * The panel is gone. What it was gesturing at — that staff accounts are issued
 * rather than self-registered — is now one line of text on the tab where it is
 * actually true.
 *
 * The form was also not a form: the inputs sat in a div and the button carried
 * an onClick, so pressing Enter in the password field did nothing. Both tabs are
 * real <form> elements now, submit on Enter, and carry the autocomplete tokens a
 * password manager needs.
 *
 * ── On the styling ─────────────────────────────────────────────────────────
 *
 * It was max-w-5xl — wider than most laptops render comfortably — for two short
 * columns, over `from-slate-900 via-slate-800 to-blue-900`, a diagonal gradient
 * in a hue the rest of the site does not use. It is now a single column at a
 * width that suits a credential form, in the same slate-and-cyan palette as the
 * page behind it.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, LogIn, UserPlus, Eye, EyeOff, Loader2, Info, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoginSuccess: (user: any) => void;
}

const fieldClass =
  "h-11 bg-slate-950/60 border-slate-700 text-white placeholder:text-slate-600 " +
  "focus-visible:border-cyan-500 focus-visible:ring-cyan-500/20 rounded-lg";

export default function LoginDialog({ open, onOpenChange, onLoginSuccess }: LoginDialogProps) {
  const [loginData, setLoginData] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({
    username: "",
    password: "",
    fullName: "",
    email: "",
    role: "patient",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  // Lifted out of Tabs so the header can name whichever tab is open. It read
  // "Sign in to your account" over the registration form.
  const [tab, setTab] = useState<"login" | "register">("login");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Reads the server's own message where there is one.
   *
   * Both mutations used to discard the response body and show a fixed string, so
   * a rate-limit ("too many login attempts, try again in 15 minutes") and a
   * genuinely wrong password produced the same "Invalid credentials" — and a user
   * locked out for fifteen minutes had no way to know that was why.
   */
  const readError = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => null);
    return body?.error || body?.message || fallback;
  };

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Those credentials were not accepted."));
      }
      return response.json();
    },
    onSuccess: (user) => {
      toast({ title: "Signed in", description: `Welcome back, ${user.fullName}.` });
      onLoginSuccess(user);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: Error) => {
      toast({ title: "Could not sign in", description: error.message, variant: "destructive" });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: typeof registerData) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await readError(response, "That account could not be created."));
      }
      return response.json();
    },
    onSuccess: (user) => {
      toast({ title: "Account created", description: `Welcome, ${user.fullName}.` });
      onLoginSuccess(user);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create account",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canLogin = Boolean(loginData.username && loginData.password);
  const canRegister = Boolean(
    registerData.username && registerData.password && registerData.fullName && registerData.email
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-800 p-0 gap-0">
        <DialogHeader className="px-6 pt-7 pb-5 space-y-0 text-left">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
              <Activity className="w-4 h-4 text-cyan-400" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-white">
              Health<span className="text-cyan-400">AI</span>
            </span>
          </div>

          <DialogTitle className="pt-5 text-xl font-semibold tracking-tight text-white">
            {tab === "login" ? "Sign in to your account" : "Create a patient account"}
          </DialogTitle>
          {/* Must be Radix's DialogDescription, not a <p> with a hand-written id.
              Radix looks up its own generated description id to decide whether the
              dialog is described; a custom aria-describedby pointing at a plain
              element satisfies the browser but not that check, which is why the
              warning fired even though the markup looked correct. */}
          <DialogDescription className="pt-1.5 text-sm text-slate-400">
            Screening results require a clinician's sign-off before they mean anything.
            Nothing here is a diagnosis.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as "login" | "register")}
          className="w-full"
        >
          <div className="px-6">
            <TabsList className="grid w-full grid-cols-2 bg-slate-950/60 border border-slate-800 rounded-lg p-1 h-auto">
              <TabsTrigger
                value="login"
                className="rounded-md py-2 text-sm font-medium text-slate-400 data-[state=active]:bg-slate-800 data-[state=active]:text-white transition-colors"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Sign in
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="rounded-md py-2 text-sm font-medium text-slate-400 data-[state=active]:bg-slate-800 data-[state=active]:text-white transition-colors"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Register
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Sign in ── */}
          <TabsContent value="login" className="mt-0">
            <form
              className="px-6 pt-6 pb-7 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canLogin && !loginMutation.isPending) loginMutation.mutate(loginData);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="login-username" className="text-sm text-slate-300">
                  Username
                </Label>
                <Input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  value={loginData.username}
                  onChange={(e) => setLoginData({ ...loginData, username: e.target.value })}
                  className={fieldClass}
                  placeholder="your.username"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password" className="text-sm text-slate-300">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={loginData.password}
                    onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                    className={`${fieldClass} pr-11`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center h-9 w-9 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={!canLogin || loginMutation.isPending}
                className="w-full h-11 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold disabled:opacity-40"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>

              {/*
                Staff accounts are issued, not self-registered — the register tab
                creates patient accounts only, and the server refuses any other
                role from that endpoint. This is where saying so is useful. It
                used to appear three times on the sign-in tab, once under each
                role card, where nobody was creating an account.
              */}
              <div className="flex gap-2.5 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  Clinician and administrator accounts are created by an administrator.
                  If you are staff and cannot sign in, ask them rather than registering.
                </p>
              </div>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    // Same tab. window.open() was popping a new one, which most
                    // browsers block when it is not a direct link click.
                    window.location.href = "/forgot-password";
                  }}
                  className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Forgot your password?
                </button>
              </div>
            </form>
          </TabsContent>

          {/* ── Register ── */}
          <TabsContent value="register" className="mt-0">
            <form
              className="px-6 pt-6 pb-7 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canRegister && !registerMutation.isPending) {
                  registerMutation.mutate(registerData);
                }
              }}
            >
              <div className="flex gap-2.5 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  This creates a <span className="text-slate-300">patient</span> account.
                  It is the only role that can be self-registered.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-fullName" className="text-sm text-slate-300">
                  Full name
                </Label>
                <Input
                  id="reg-fullName"
                  name="name"
                  autoComplete="name"
                  value={registerData.fullName}
                  onChange={(e) => setRegisterData({ ...registerData, fullName: e.target.value })}
                  className={fieldClass}
                  placeholder="As it appears on your records"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-email" className="text-sm text-slate-300">
                  Email
                </Label>
                <Input
                  id="reg-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={registerData.email}
                  onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                  className={fieldClass}
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-username" className="text-sm text-slate-300">
                  Username
                </Label>
                <Input
                  id="reg-username"
                  name="username"
                  autoComplete="username"
                  value={registerData.username}
                  onChange={(e) => setRegisterData({ ...registerData, username: e.target.value })}
                  className={fieldClass}
                  placeholder="Letters, numbers and underscores"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-password" className="text-sm text-slate-300">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="reg-password"
                    name="new-password"
                    type={showRegPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={registerData.password}
                    onChange={(e) =>
                      setRegisterData({ ...registerData, password: e.target.value })
                    }
                    className={`${fieldClass} pr-11`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword(!showRegPassword)}
                    aria-label={showRegPassword ? "Hide password" : "Show password"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center h-9 w-9 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    {showRegPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {/* The server enforces this; saying so up front beats failing on
                    submit with a message the user then has to decode. */}
                <p className="text-xs text-slate-500 pt-0.5">
                  At least 8 characters, with an uppercase letter, a lowercase letter,
                  a number and one of ! @ # $ % ^ &amp; *
                </p>
              </div>

              <Button
                type="submit"
                disabled={!canRegister || registerMutation.isPending}
                className="w-full h-11 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold disabled:opacity-40"
              >
                {registerMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
