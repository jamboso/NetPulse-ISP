import { useState } from "react";
import { useLocation } from "wouter";
import { signIn, requestPasswordReset } from "@/lib/authClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wifi, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);
  const [forgotError, setForgotError] = useState("");

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

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    setForgotError("");
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const res = await requestPasswordReset({ email: forgotEmail, redirectTo });
      if (res.error) {
        setForgotError(res.error.message ?? "Failed to send reset email.");
      } else {
        setForgotDone(true);
      }
    } catch {
      setForgotError("Something went wrong. Please try again.");
    } finally {
      setForgotLoading(false);
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
                      onClick={() => { setShowForgot(true); setForgotEmail(email); setForgotDone(false); setForgotError(""); }}
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
              {forgotDone ? (
                <div className="space-y-4 text-center py-2">
                  <div className="flex justify-center">
                    <CheckCircle2 className="w-12 h-12 text-green-500" />
                  </div>
                  <p className="text-gray-800 font-semibold">Check your email</p>
                  <p className="text-sm text-gray-500">
                    If an account exists for <strong>{forgotEmail}</strong>, a password reset link has been sent. Check your inbox (and spam folder).
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => { setShowForgot(false); setForgotDone(false); }}
                    className="w-full"
                  >
                    Back to sign in
                  </Button>
                </div>
              ) : (
                <>
                  {forgotError && (
                    <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {forgotError}
                    </div>
                  )}

                  <p className="text-sm text-gray-500">
                    Enter your email address and we'll send you a link to reset your password.
                  </p>

                  <form onSubmit={handleForgot} className="space-y-4">
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
                      disabled={forgotLoading || !forgotEmail}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      {forgotLoading ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending…</>
                      ) : (
                        "Send reset link"
                      )}
                    </Button>
                  </form>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setShowForgot(false)}
                      className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Back to sign in
                    </button>
                  </div>
                </>
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
