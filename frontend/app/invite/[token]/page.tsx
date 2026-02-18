"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { acceptInvite, getInviteInfo, ROLE_LABEL_MAP, CLINICAL_ROLES } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function InviteRegisterPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [licenseNo, setLicenseNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isClinicalInvite = CLINICAL_ROLES.has(role);

  useEffect(() => {
    const loadInvite = async () => {
      try {
        setLoading(true);
        const info = await getInviteInfo(token);
        setEmail(info.email);
        setRole(info.role);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invite link is invalid or expired";
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    loadInvite();
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (isClinicalInvite && !licenseNo.trim()) {
      setError("License number is required for clinical roles.");
      return;
    }

    try {
      setSubmitting(true);
      await acceptInvite(token, {
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        password,
        license_no: licenseNo || undefined,
      });
      router.replace("/login");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create account";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading invite...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 border-border shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <h2 className="text-2xl font-semibold">Complete your account setup</h2>
          <p className="text-sm text-muted-foreground">
            This invitation was created by an administrator.
          </p>
        </CardHeader>
        <CardContent>
          {error && !email ? (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Link href="/login" className="text-primary hover:underline text-sm">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={email} disabled />
              </div>

              <div className="space-y-2">
                <Label>Assigned role</Label>
                <Input value={ROLE_LABEL_MAP[role] || role} disabled />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first_name">First name</Label>
                  <Input
                    id="first_name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">Last name</Label>
                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                  />
                </div>
              </div>

              {isClinicalInvite && (
                <div className="space-y-2">
                  <Label htmlFor="license_no">License Number <span className="text-red-500">*</span></Label>
                  <Input
                    id="license_no"
                    value={licenseNo}
                    required
                    onChange={(e) => setLicenseNo(e.target.value)}
                    placeholder="e.g., MD-12345"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for clinical roles.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm_password">Confirm password</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  minLength={8}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Creating account..." : "Create account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
