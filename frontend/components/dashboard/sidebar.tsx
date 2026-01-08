"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  UserGroupIcon,
  Logout01Icon,
  Settings01Icon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { useAuthStore } from "@/store/auth-store";

const menuItems = [
  { icon: DashboardSquare01Icon, label: "Overview", href: "/patients", active: true },
  { icon: UserGroupIcon, label: "Patients", href: "/patients", active: true },
];

export function DashboardSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const clearToken = useAuthStore((state) => state.clearToken);
  const router = useRouter();

  return (
    <Sidebar collapsible="offExamples" className="lg:border-r-0!" {...props}>
      <SidebarHeader className="p-5 pb-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-full bg-linear-to-br from-sky-500 to-blue-700" />
            <span className="font-medium text-muted-foreground">Patient Admin</span>
          </div>
          <Avatar className="size-7">
            <AvatarImage src="https://api.dicebear.com/9.x/glass/svg?seed=staff" />
            <AvatarFallback>ST</AvatarFallback>
          </Avatar>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-5 pt-5">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    isActive={item.active}
                    className="h-[38px]"
                    onClick={() => router.push(item.href)}
                  >
                    <HugeiconsIcon icon={item.icon} className="size-5" />
                    <span className="flex-1">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-5 pb-5 space-y-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => {
            clearToken();
            router.replace("/login");
          }}
        >
          <HugeiconsIcon icon={Logout01Icon} className="size-4" />
          Logout
        </Button>

        <Button variant="ghost" className="w-full justify-start gap-2">
          <HugeiconsIcon icon={Settings01Icon} className="size-4" />
          Settings
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
