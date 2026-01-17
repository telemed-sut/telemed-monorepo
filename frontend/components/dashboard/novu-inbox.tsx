"use client";

import { Inbox } from "@novu/react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuthStore } from "@/store/auth-store";

// Novu configuration from dashboard
const NOVU_APPLICATION_ID = "NY121hjvX71B";
// For demo: use the subscriber ID from Novu onboarding
// For production: this should be the user ID from your database
const DEMO_SUBSCRIBER_ID = "69672b3590916202e24e18f7";

export function NovuInbox() {
    const router = useRouter();
    const { resolvedTheme } = useTheme();
    const userId = useAuthStore((state) => state.userId);
    const isDark = resolvedTheme === "dark";

    // Don't render if no user is logged in
    if (!userId) {
        return null;
    }

    // Use demo subscriber ID for now
    // TODO: For production, sync users with Novu and use userId
    const subscriberId = DEMO_SUBSCRIBER_ID;

    return (
        <Inbox
            applicationIdentifier={NOVU_APPLICATION_ID}
            subscriberId={subscriberId}
            routerPush={(path: string) => router.push(path)}
            appearance={{
                variables: {
                    colorPrimary: "#8b5cf6",
                    colorForeground: isDark ? "#f8fafc" : "#0E1218",
                    colorBackground: isDark ? "#1e293b" : "#ffffff",
                    colorNeutral: isDark ? "#94a3b8" : "#64748b",
                },
                elements: {
                    bellIcon: {
                        width: "20px",
                        height: "20px",
                        color: isDark ? "#f8fafc" : "#0E1218",
                    },
                    popoverContent: {
                        borderRadius: "12px",
                        boxShadow: isDark
                            ? "0 10px 40px rgba(0, 0, 0, 0.5)"
                            : "0 10px 40px rgba(0, 0, 0, 0.15)",
                        backgroundColor: isDark ? "#1e293b" : "#ffffff",
                        border: isDark ? "1px solid #334155" : "1px solid #e2e8f0",
                        zIndex: 9999,
                        maxHeight: "500px",
                        overflow: "hidden",
                    },
                    notificationList: {
                        maxHeight: "400px",
                        overflowY: "auto",
                        paddingBottom: "40px",
                    },
                },
            }}
        />
    );
}
