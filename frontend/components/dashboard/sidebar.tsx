"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Home,
  Users,
  CalendarDays,
  UserCog,
  ScrollText,
  Shield,
  HelpCircle,
  Settings,
  ChevronsUpDown,
  LogOut,
  UserCircle,
  ChevronRight,
  Activity,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { useAuthStore } from "@/store/auth-store";
import { fetchCurrentUser, logout, UserMe, ROLE_LABEL_MAP } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/store/language-store";
import { type AppLanguage } from "@/store/language-config";

interface NavItem {
  id: string;
  icon: React.ElementType;
  link: string;
}

const baseRoutes: NavItem[] = [
  { id: "overview", icon: Home, link: "/overview" },
  { id: "patients", icon: Users, link: "/patients" },
];

const meetingsRoute: NavItem = {
  id: "meetings",
  icon: CalendarDays,
  link: "/meetings",
};

const adminOnlyRoutes: NavItem[] = [
  { id: "users", icon: UserCog, link: "/users" },
  { id: "device-monitor", icon: Activity, link: "/device-monitor" },
  { id: "audit-logs", icon: ScrollText, link: "/audit-logs" },
  { id: "security", icon: Shield, link: "/security" },
];

const SIDEBAR_LABELS: Record<
  AppLanguage,
  {
    routes: Record<string, string>;
    helpCenter: string;
    loading: string;
    account: string;
    profile: string;
    settings: string;
    logOut: string;
  }
> = {
  en: {
    routes: {
      overview: "Overview",
      patients: "Patients",
      meetings: "Meetings",
      users: "Users",
      "device-monitor": "Device Monitor",
      "audit-logs": "Audit Logs",
      security: "Security",
    },
    helpCenter: "Help Center",
    loading: "Loading...",
    account: "Account",
    profile: "Profile",
    settings: "Settings",
    logOut: "Log out",
  },
  th: {
    routes: {
      overview: "ภาพรวม",
      patients: "ผู้ป่วย",
      meetings: "การนัดหมาย",
      users: "ผู้ใช้",
      "device-monitor": "มอนิเตอร์อุปกรณ์",
      "audit-logs": "บันทึก Audit",
      security: "ความปลอดภัย",
    },
    helpCenter: "ศูนย์ช่วยเหลือ",
    loading: "กำลังโหลด...",
    account: "บัญชีผู้ใช้",
    profile: "โปรไฟล์",
    settings: "ตั้งค่า",
    logOut: "ออกจากระบบ",
  },
};

function getRouteTitle(routeId: string, language: AppLanguage): string {
  return SIDEBAR_LABELS[language].routes[routeId] || routeId;
}

const ROLE_LABELS_BY_LANGUAGE: Record<AppLanguage, Record<string, string>> = {
  en: ROLE_LABEL_MAP,
  th: {
    admin: "ผู้ดูแลระบบ",
    doctor: "แพทย์",
    staff: "เจ้าหน้าที่",
    nurse: "พยาบาล",
    pharmacist: "เภสัชกร",
    medical_technologist: "นักเทคนิคการแพทย์",
    psychologist: "นักจิตวิทยา",
  },
};

function getRoleLabel(role: string, language: AppLanguage): string {
  return (
    ROLE_LABELS_BY_LANGUAGE[language][role] ||
    ROLE_LABEL_MAP[role] ||
    role.charAt(0).toUpperCase() + role.slice(1)
  );
}

function getUserDisplayName(user: UserMe): string {
  if (user.first_name || user.last_name) {
    return [user.first_name, user.last_name].filter(Boolean).join(" ");
  }
  return user.email.split("@")[0];
}

function getUserInitials(user: UserMe): string {
  if (user.first_name && user.last_name) {
    return (user.first_name[0] + user.last_name[0]).toUpperCase();
  }
  if (user.first_name) return user.first_name.slice(0, 2).toUpperCase();
  return user.email.slice(0, 2).toUpperCase();
}

export function DashboardSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { state } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const language = useLanguageStore((state) => state.language);
  const t = SIDEBAR_LABELS[language];
  const token = useAuthStore((state) => state.token);
  const userRole = useAuthStore((state) => state.role);
  const clearToken = useAuthStore((state) => state.clearToken);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchCurrentUser(token)
      .then((user) => { if (!cancelled) setCurrentUser(user); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [token]);

  const showMeetings = userRole === "admin" || userRole === "doctor";
  const navRoutes = [
    ...baseRoutes,
    ...(showMeetings ? [meetingsRoute] : []),
    ...(userRole === "admin" ? adminOnlyRoutes : []),
  ];

  const isActive = (link: string) => {
    if (link === "/overview") return pathname === "/overview" || pathname === "/";
    return pathname.startsWith(link);
  };

  const handleLogout = () => {
    void logout(token || undefined).catch(() => undefined).finally(() => {
      clearToken();
      router.replace("/login");
    });
  };
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="lg:border-r-0!" {...props}>
      {/* ── Header: Logo ── */}
      <SidebarHeader className={cn(
        "pb-0 transition-all duration-200",
        isCollapsed ? "px-2 pt-4" : "p-3 sm:p-4 lg:p-5"
      )}>
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-2")}>
          <Logo className={cn("transition-all duration-200", isCollapsed ? "h-14 w-14" : "h-12 w-12")} />
          {!isCollapsed && <span className="font-semibold text-base sm:text-lg">E Med Help</span>}
        </div>
      </SidebarHeader>

      <SidebarContent className={cn(
        "transition-[padding] duration-200",
        isCollapsed ? "px-2" : "px-3 sm:px-4 lg:px-5"
      )}>
        {/* ── Menu ── */}
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {navRoutes.map((route) => {
                const active = isActive(route.link);
                const Icon = route.icon;
                return (
                  <SidebarMenuItem
                    key={route.id}
                    className={cn(isCollapsed && "flex justify-center")}
                  >
                    <SidebarMenuButton
                      id={`sidebar-item-${route.id}`}
                      isActive={active}
                      tooltip={getRouteTitle(route.id, language)}
                      className={cn(
                        "h-9 border border-sidebar-border/60 transition-[padding,border-color,background-color] duration-200 hover:border-sidebar-border sm:h-[38px] data-[active=true]:border-sidebar-border data-[active=true]:shadow-[0_0_0_1px_hsl(var(--sidebar-border))]",
                        isCollapsed && "justify-center px-0"
                      )}
                    >
                      <Link
                        href={route.link}
                        prefetch={true}
                        className={cn(
                          "flex w-full items-center",
                          isCollapsed ? "justify-center" : "gap-2.5"
                        )}
                      >
                        <Icon className="size-4 sm:size-5" />
                        {!isCollapsed && (
                          <span className="text-sm">{getRouteTitle(route.id, language)}</span>
                        )}
                        {!isCollapsed && active && (
                          <ChevronRight className="ml-auto size-4 text-muted-foreground opacity-60" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer: Help, User Profile ── */}
      <SidebarFooter className={cn(
        "pb-3 transition-[padding] duration-200 sm:pb-4 lg:pb-5",
        isCollapsed ? "px-2" : "px-3 sm:px-4 lg:px-5"
      )}>
        <SidebarMenu>
          <SidebarMenuItem className={cn(isCollapsed && "flex justify-center")}>
            <SidebarMenuButton
              id="sidebar-help-button"
              tooltip={t.helpCenter}
              className={cn("h-9 sm:h-[38px]", isCollapsed && "justify-center px-0")}
            >
              <HelpCircle className="size-4 sm:size-5" />
              {!isCollapsed && <span className="text-sm">{t.helpCenter}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* User profile dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            id="sidebar-user-menu-button"
            className={cn(
              "w-full cursor-pointer rounded-lg p-2 transition-colors hover:bg-accent sm:p-3",
              isCollapsed ? "flex justify-center" : "flex items-center gap-2 sm:gap-3"
            )}
          >
            <Avatar className="size-7 sm:size-8">
              <AvatarImage
                src={currentUser ? `https://api.dicebear.com/9.x/glass/svg?seed=${currentUser.email}` : undefined}
              />
              <AvatarFallback className="text-xs">
                {currentUser ? getUserInitials(currentUser) : "??"}
              </AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-xs font-semibold sm:text-sm">
                    {currentUser ? getUserDisplayName(currentUser) : t.loading}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground sm:text-xs">
                    {currentUser?.email || ""}
                  </p>
                </div>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isCollapsed ? "center" : "end"} className="w-[200px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {currentUser ? getRoleLabel(currentUser.role, language) : t.account}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuItem onClick={() => router.push("/profile")}>
              <UserCircle className="size-4 mr-2" />
              {t.profile}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings className="size-4 mr-2" />
              {t.settings}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleLogout}>
              <LogOut className="size-4 mr-2" />
              {t.logOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
