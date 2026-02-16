"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthStore } from "@/store/auth-store";

export function SettingsContent() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const clearToken = useAuthStore((state) => state.clearToken);
  const getTokenTTL = useAuthStore((state) => state.getTokenTTL);

  const [tokenTTL, setTokenTTL] = useState(() => getTokenTTL());

  useEffect(() => {
    if (hydrated && !token) {
      router.replace("/login");
    }
  }, [hydrated, token, router]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTokenTTL(getTokenTTL());
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [getTokenTTL]);

  const ttlLabel = useMemo(() => {
    if (!tokenTTL) return "Expired";
    const minutes = Math.floor(tokenTTL / 60);
    const seconds = tokenTTL % 60;
    return `${minutes}m ${seconds}s`;
  }, [tokenTTL]);

  return (
    <main className="w-full flex-1 overflow-auto p-4 sm:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Select your preferred dashboard theme.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant={theme === "light" ? "default" : "outline"} onClick={() => setTheme("light")}>
            Light
          </Button>
          <Button variant={theme === "dark" ? "default" : "outline"} onClick={() => setTheme("dark")}>
            Dark
          </Button>
          <Button variant={theme === "system" ? "default" : "outline"} onClick={() => setTheme("system")}>
            System
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Manage your profile and session.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push("/profile")}>
            Open profile
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              clearToken();
              router.replace("/login");
            }}
          >
            Log out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>Current access token status.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            Token TTL: <span className="font-medium">{ttlLabel}</span>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
