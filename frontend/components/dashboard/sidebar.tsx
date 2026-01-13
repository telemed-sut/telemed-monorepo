"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  Home,
  Users,
} from "lucide-react";
import { SVGProps } from "react";
import DashboardNavigation, { Route } from "./nav-main";
import { NotificationsPopover } from "./nav-notifications";
import { TeamSwitcher } from "./team-switcher";
import { Logo } from "@/components/ui/logo";
import { AdminLogo } from "@/components/ui/admin-logo";



const sampleNotifications = [
  {
    id: "1",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=staff",
    fallback: "OM",
    text: "New patient registered.",
    time: "10m ago",
  },
  {
    id: "2",
    avatar: "https://api.dicebear.com/9.x/glass/svg?seed=admin",
    fallback: "JL",
    text: "System maintenance scheduled.",
    time: "1h ago",
  },
];

const dashboardRoutes: Route[] = [
  {
    id: "overview",
    title: "Overview",
    icon: <Home className="size-4" />,
    link: "/overview",
  },
  {
    id: "patients",
    title: "Patients",
    icon: <Users className="size-4" />,
    link: "/patients",
  },
];

const teams = [
  { id: "1", name: "Patient Admin", logo: AdminLogo, plan: "Pro" },
];

export function DashboardSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader
        className={cn(
          "flex md:pt-3.5",
          isCollapsed
            ? "flex-row items-center justify-between gap-y-4 md:flex-col md:items-start md:justify-start"
            : "flex-row items-center justify-between"
        )}
      >
        <a href="/patients" className="flex items-center gap-2">
          <Logo className="h-8 w-8" />
          {!isCollapsed && (
            <span className="font-semibold text-black dark:text-white">
              Patient
            </span>
          )}
        </a>

        <motion.div
          key={isCollapsed ? "header-collapsed" : "header-expanded"}
          className={cn(
            "flex items-center gap-2",
            isCollapsed ? "flex-row md:flex-col-reverse" : "flex-row"
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          <NotificationsPopover notifications={sampleNotifications} />
          <SidebarTrigger />
        </motion.div>
      </SidebarHeader>
      <SidebarContent className="gap-4 px-2 py-4">
        {/* Frosted Glass Navigation - Individual Frames */}
        <div className="flex flex-col gap-2">
          {dashboardRoutes.map((route) => (
            <div
              key={route.id}
              className="relative overflow-hidden rounded-xl bg-white/10 dark:bg-white/5 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-[4px_4px_12px_rgba(0,0,0,0.06),-4px_-4px_12px_rgba(255,255,255,0.05),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(255,255,255,0.08)] hover:bg-white/15 dark:hover:bg-white/8 hover:shadow-[6px_6px_16px_rgba(0,0,0,0.08),-6px_-6px_16px_rgba(255,255,255,0.06)] transition-all duration-200"
            >
              <DashboardNavigation routes={[route]} />
            </div>
          ))}
        </div>
      </SidebarContent>
      <SidebarFooter className="px-2">
        <TeamSwitcher teams={teams} />
      </SidebarFooter>
    </Sidebar >
  );
}
