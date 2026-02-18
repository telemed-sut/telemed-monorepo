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
import { toast } from "@/components/ui/toast";
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

  const handlePromiseToast = () => {
    const simulatedTask = new Promise<{ ok: boolean }>((resolve) => {
      setTimeout(() => resolve({ ok: true }), 1800);
    });

    toast.promise(simulatedTask, {
      loading: { title: "Processing request..." },
      success: { title: "Completed", description: "Background task finished successfully." },
      error: { title: "Failed", description: "Something went wrong. Please retry." },
    });
  };

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

      <Card>
        <CardHeader>
          <CardTitle>Sileo Playground</CardTitle>
          <CardDescription>Trigger each Sileo type exactly like the playground style.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl bg-neutral-950 p-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl bg-neutral-900 px-4 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                onClick={() =>
                  toast.success("Success", { description: "Saved changes successfully." })
                }
              >
                Success
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl bg-neutral-900 px-4 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                onClick={() =>
                  toast.error("Error", { description: "Unable to save data right now." })
                }
              >
                Error
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl bg-neutral-900 px-4 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                onClick={() =>
                  toast.warning("Warning", { description: "Storage is reaching capacity." })
                }
              >
                Warning
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl bg-neutral-900 px-4 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                onClick={() =>
                  toast.info("Info", { description: "System maintenance starts at 22:00." })
                }
              >
                Info
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl bg-neutral-900 px-4 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                onClick={() =>
                  toast.action("Storage Almost Full", {
                    description: "You've used 95% of your available storage.",
                    button: {
                      title: "Upgrade",
                      onClick: () => toast.success("Upgrade flow opened"),
                    },
                  })
                }
              >
                Action
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl bg-neutral-900 px-4 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                onClick={() =>
                  toast.info("Custom Icon", {
                    description: "Realtime sync is running.",
                    icon: <span className="font-semibold">i</span>,
                  })
                }
              >
                Icon
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl bg-neutral-900 px-4 text-neutral-300 hover:bg-neutral-800 hover:text-white"
                onClick={handlePromiseToast}
              >
                Promise
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
