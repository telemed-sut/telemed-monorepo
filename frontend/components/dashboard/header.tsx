"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardSquare01Icon, SidebarLeft01Icon, Logout01Icon } from "@hugeicons/core-free-icons";
import { useAuthStore } from "@/store/auth-store";

export function DashboardHeader() {
  const clearToken = useAuthStore((state) => state.clearToken);
  const router = useRouter();

  const handleLogout = () => {
    clearToken();
    router.replace("/login");
  };

  return (
    <header className="w-full flex items-center gap-3 px-4 sm:px-6 py-4 border-b bg-background">
      <SidebarTrigger className="lg:hidden">
        <HugeiconsIcon icon={SidebarLeft01Icon} className="size-5" />
      </SidebarTrigger>

      <HugeiconsIcon icon={DashboardSquare01Icon} className="size-6" />
      <div className="flex flex-col">
        <h1 className="font-medium text-base">Patient Dashboard</h1>
        <p className="text-xs text-muted-foreground">Protected area — JWT required</p>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <ThemeToggle />
        <Button variant="outline" size="sm" className="gap-2" onClick={handleLogout}>
          <HugeiconsIcon icon={Logout01Icon} className="size-4" />
          Logout
        </Button>
      </div>
    </header>
  );
}
