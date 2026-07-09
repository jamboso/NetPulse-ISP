import { useState } from "react";
import { useLocation } from "wouter";
import { signIn, requestPasswordReset } from "@/lib/authClient";
import {
  useGetPasswordResetMethods,
  useRequestPasswordResetCode,
  useVerifySmsResetCode,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wifi, Loader2, AlertCircle, CheckCircle2, Mail, MessageSquare } from "lucide-react";

type ForgotStep = "email" | "choose" | "email-sent" | "sms-code" | "sms-done";

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotStep, setForgotStep] = useState<ForgotStep>("email");
  const [forgotError, setForgotError] = useState("");
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [hasSms, setHasSms] = useState(false);

  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const methodsMutation = useGetPasswordResetMethods();
  const requestMutation = useRequestPasswordResetCode();
  const verifySmsMutation = useVerifySmsResetCode();

  const resetForgotState = () => {
    setShowForgot(false);
    setForgotStep("email");
    setForgotError("");
    setOtpCode("");
    setNewPassword("");
    setConfirmNewPassword("");
    setMaskedPhone(null);
    setHasSms(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Invalid email or password");
      } else {
        setLocation("/");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const openForgot = () => {
    setShowForgot(true);
    setForgotEmail(email);
    setForgotStep("email");
    setForgotError("");
  };

  const handleCheckMethods = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotError("");
    try {
      const data = await methodsMutation.mutateAsync({ data: { email: forgotEmail } });
      setHasSms(data.hasSms);
      setMaskedPhone(data.maskedPhone ?? null);
      setForgotStep("choose");
    } catch {
      setForgotError("Something went wrong. Please try again.");
    }
  };

  const handleChooseEmail = async () => {
    setForgotError("");
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const res = await requestPasswordReset({ email: forgotEmail, redirectTo });
      if (res.error) {
        setForgotError(res.error.message ?? "Failed to send reset email.");
        return;
      }
      setForgotStep("email-sent");
    } catch {
      setForgotError("Something went wrong. Please try again.");
    }
  };

  const handleChooseSms = async () => {
    setForgotError("");
    try {
      await requestMutation.mutateAsync({ data: { email: forgotEmail, method: "sms" } });
      setForgotStep("sms-code");
    } catch {
      setForgotError("Something went wrong. Please try again.");
    }
  };

  const handleVerifySms = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    if (newPassword.length < 8) {
      setForgotError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setForgotError("Passwords do not match.");
      return;
    }
    try {
      await verifySmsMutation.mutateAsync({
        data: { email: forgotEmail, code: otpCode, newPassword },
      });
      setForgotStep("sms-done");
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "error" in err
          ? String((err as { error?: string }).error)
          : "Invalid or expired code. Please try again.";
      setForgotError(message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mb-3">
            <Wifi className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">NetPulse ISP</h1>
          <p className="text-slate-400 text-sm mt-1">
            {showForgot ? "Reset your password" : "Sign in to your account"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-xl p-6 space-y-4">
          {!showForgot ? (
            <>
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@myisp.co.ke"
                    required
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                      Password
                    </Label>
                    <button
                      type="button"
                      onClick={openForgot}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Signing in…</>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </>
          ) : (
            <>
              {forgotError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {forgotError}
                </div>
              )}

              {/* Step 1: enter email */}
              {forgotStep === "email" && (
                <>
                  <p className="text-sm text-gray-500">
                    Enter your email address and we'll show you how you can reset your password.
                  </p>
                  <form onSubmit={handleCheckMethods} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="forgotEmail" className="text-sm font-medium text-gray-700">
                        Email address
                      </Label>
                      <Input
                        id="forgotEmail"
                        type="email"
                        autoComplete="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="admin@myisp.co.ke"
                        required
                        autoFocus
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={methodsMutation.isPending || !forgotEmail}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      {methodsMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Checking…</>
                      ) : (
                        "Continue"
                      )}
                    </Button>
                  </form>
                </>
              )}

              {/* Step 2: choose method */}
              {forgotStep === "choose" && (
                <>
                  <p className="text-sm text-gray-500">
                    How would you like to receive your reset code?
                  </p>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleChooseEmail}
                      disabled={requestMutation.isPending}
                      className="w-full flex items-center gap-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors px-4 py-3 text-left"
                    >
                      <Mail className="w-5 h-5 text-blue-600 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-800">Email</p>
                        <p className="text-xs text-gray-500">Send a reset link to {forgotEmail}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={handleChooseSms}
                      disabled={!hasSms || requestMutation.isPending}
                      className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                        hasSms
                          ? "border-gray-200 hover:border-blue-400 hover:bg-blue-50"
                          : "border-gray-100 opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <MessageSquare className="w-5 h-5 text-blue-600 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-800">SMS</p>
                        <p className="text-xs text-gray-500">
                          {hasSms
                            ? `Send a code to ${maskedPhone}`
                            : "No phone number on file for this account"}
                        </p>
                      </div>
                      {requestMutation.isPending && <Loader2 className="w-4 h-4 animate-spin ml-auto text-gray-400" />}
                    </button>
                  </div>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setForgotStep("email")}
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Back
                    </button>
                  </div>
                </>
              )}

              {/* Step 3a: email sent confirmation */}
              {forgotStep === "email-sent" && (
                <div className="space-y-4 text-center py-2">
                  <div className="flex justify-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500" />
                  </div>
                  <p className="text-gray-800 font-semibold">Check your email</p>
                  <p className="text-sm text-gray-500">
                    If an account exists for <strong>{forgotEmail}</strong>, a password reset link has been sent. Check your inbox (and spam folder).
                  </p>
                  <Button variant="outline" onClick={resetForgotState} className="w-full">
                    Back to sign in
                  </Button>
                </div>
              )}

              {/* Step 3b: SMS code + new password */}
              {forgotStep === "sms-code" && (
                <>
                  <p className="text-sm text-gray-500">
                    Enter the 6-digit code sent to {maskedPhone} and choose a new password.
                  </p>
                  <form onSubmit={handleVerifySms} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="otpCode" className="text-sm font-medium text-gray-700">
                        Verification code
                      </Label>
                      <Input
                        id="otpCode"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="123456"
                        required
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="newPassword" className="text-sm font-medium text-gray-700">
                        New password
                      </Label>
                      <Input
                        id="newPassword"
                        type="password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min. 8 characters"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmNewPassword" className="text-sm font-medium text-gray-700">
                        Confirm new password
                      </Label>
                      <Input
                        id="confirmNewPassword"
                        type="password"
                        autoComplete="new-password"
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={verifySmsMutation.isPending || otpCode.length !== 6 || !newPassword || !confirmNewPassword}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      {verifySmsMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Resetting…</>
                      ) : (
                        "Reset password"
                      )}
                    </Button>
                  </form>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setForgotStep("choose")}
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Back
                    </button>
                  </div>
                </>
              )}

              {/* Step 3c: SMS reset done */}
              {forgotStep === "sms-done" && (
                <div className="space-y-4 text-center py-2">
                  <div className="flex justify-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500" />
                  </div>
                  <p className="text-gray-800 font-semibold">Password reset</p>
                  <p className="text-sm text-gray-500">
                    Your password has been reset successfully. You can now sign in with your new password.
                  </p>
                  <Button
                    onClick={() => { setPassword(""); setEmail(forgotEmail); resetForgotState(); }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                  >
                    Back to sign in
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          NetPulse ISP Manager · Self-hosted
        </p>
      </div>
    </div>
  );
}
