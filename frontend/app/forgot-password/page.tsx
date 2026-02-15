"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setResetToken(null);

    try {
      const response = await requestPasswordReset(email);
      setSuccessMessage(response.message);
      if (response.reset_token) {
        setResetToken(response.reset_token);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to request password reset";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 border-border shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <h2 className="text-2xl font-semibold">Forgot password</h2>
          <p className="text-sm text-muted-foreground">
            Enter your work email to request a reset link.
          </p>
          <p className="text-xs text-muted-foreground">
            This is a closed system. New accounts are provisioned by administrators only.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@hospital.org"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            {successMessage && (
              <p className="text-sm text-green-600" role="status">
                {successMessage}
              </p>
            )}

            {resetToken && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium mb-1">Development token</p>
                <p className="break-all">{resetToken}</p>
                <Link className="text-primary hover:underline mt-2 inline-block" href={`/reset-password?token=${encodeURIComponent(resetToken)}`}>
                  Continue to reset password
                </Link>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Submitting..." : "Request reset"}
            </Button>
          </form>

          <div className="mt-4 text-sm text-center">
            <Link href="/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
