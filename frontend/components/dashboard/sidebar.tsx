"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
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
import { Badge } from "@/components/ui/badge";
import {
  Home,
  Users,
  CalendarDays,
  UserCog,
  ScrollText,
  Shield,
  HelpCircle,
  ChevronsUpDown,
  ChevronRight,
  Activity,
  Cpu,
  Crown,
  ShieldCheck,
  Stethoscope,
  GraduationCap,
  Building2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { useAuthStore } from "@/store/auth-store";
import {
  canManageUsers,
  canViewClinicalData,
  fetchCurrentUser,
  getAdminSsoLogoutPath,
  getPrivilegedRoleLabel,
  logout,
  ROLE_LABEL_MAP,
  UserMe,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/store/language-store";
import { type AppLanguage } from "@/store/language-config";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Logout01Icon,
  Settings01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";

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
  { id: "device-registry", icon: Cpu, link: "/device-registry" },
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
      "device-registry": "Device Registry",
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
      "device-registry": "ทะเบียนอุปกรณ์",
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
    medical_student: "นักศึกษาแพทย์",
  },
};

function getRoleLabel(role: string, language: AppLanguage): string {
  return (
    ROLE_LABELS_BY_LANGUAGE[language][role] ||
    ROLE_LABEL_MAP[role] ||
    role.charAt(0).toUpperCase() + role.slice(1)
  );
}

function getPrivilegeBadgeClass(role: string): string {
  if (role === "platform_super_admin") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }
  if (role === "security_admin") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-700";
  }
  if (role === "hospital_admin") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700";
  }
  return "border-border bg-muted text-foreground";
}

function getRoleIcon(role: string): React.ElementType {
  if (role === "doctor") return Stethoscope;
  if (role === "medical_student") return GraduationCap;
  return UserCog;
}

function getPrivilegedRoleIcon(role: string): React.ElementType {
  if (role === "platform_super_admin") return Crown;
  if (role === "security_admin") return ShieldCheck;
  if (role === "hospital_admin") return Building2;
  return Shield;
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

type ProfileMenuItem = "profile" | "settings" | "logout";

function SidebarUserMenu({
  isCollapsed,
  currentUser,
  roleLabel,
  language,
  labels,
  activeItem,
  onProfile,
  onSettings,
  onLogout,
}: {
  isCollapsed: boolean;
  currentUser: UserMe | null;
  roleLabel: string;
  language: AppLanguage;
  labels: {
    loading: string;
    profile: string;
    settings: string;
    logOut: string;
  };
  activeItem: ProfileMenuItem | null;
  onProfile: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<ProfileMenuItem | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const menuItems: (
    | {
        id: ProfileMenuItem;
        label: string;
        icon: typeof UserIcon;
        onSelect: () => void;
        destructive?: boolean;
      }
    | {
        id: "divider";
      }
  )[] = [
    { id: "profile", label: labels.profile, icon: UserIcon, onSelect: onProfile },
    { id: "settings", label: labels.settings, icon: Settings01Icon, onSelect: onSettings },
    { id: "divider" },
    { id: "logout", label: labels.logOut, icon: Logout01Icon, onSelect: onLogout, destructive: true },
  ];
  const roleIcon = currentUser ? getRoleIcon(currentUser.role) : UserCog;

  return (
    <div ref={containerRef} className="relative mx-auto w-full max-w-[228px]">
      <button
        id="sidebar-user-menu-button"
        type="button"
        className={cn(
          "w-full cursor-pointer rounded-[22px] border border-sidebar-border/60 bg-white/80 text-left shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-[1px] hover:border-sidebar-border hover:bg-white hover:shadow-[0_10px_20px_rgba(15,23,42,0.07)]",
          isCollapsed ? "flex justify-center p-2" : "flex items-center gap-2 px-2.5 py-2",
          isOpen && "border-sidebar-primary/20 bg-white shadow-[0_10px_22px_rgba(15,23,42,0.09)]"
        )}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Avatar className="size-9 ring-1 ring-black/5 sm:size-10">
          <AvatarImage
            src={
              currentUser
                ? `https://api.dicebear.com/9.x/glass/svg?seed=${currentUser.email}`
                : undefined
            }
          />
          <AvatarFallback className="text-[0.82rem]">
            {currentUser ? getUserInitials(currentUser) : "??"}
          </AvatarFallback>
        </Avatar>
        {!isCollapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[0.88rem] font-semibold leading-tight text-slate-900">
                    {currentUser ? getUserDisplayName(currentUser) : labels.loading}
                  </p>
                </div>
                <ChevronsUpDown className={cn(
                  "mt-0.5 size-3.5 shrink-0 text-slate-400 transition-transform duration-200",
                  isOpen && "rotate-180 text-slate-600"
                )} />
              </div>
              {currentUser ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <span
                    title={getRoleLabel(currentUser.role, language)}
                    aria-label={getRoleLabel(currentUser.role, language)}
                    className="inline-flex h-4.5 w-4.5 items-center justify-center rounded-full border border-border/80 bg-slate-50 text-slate-600"
                  >
                    {React.createElement(roleIcon, { className: "h-2.5 w-2.5" })}
                  </span>
                  {currentUser.privileged_roles?.map((role) => {
                    const PrivilegedIcon = getPrivilegedRoleIcon(role);
                    return (
                      <span
                        key={role}
                        title={getPrivilegedRoleLabel(role, language)}
                        aria-label={getPrivilegedRoleLabel(role, language)}
                        className={cn(
                          "inline-flex h-4.5 w-4.5 items-center justify-center rounded-full border",
                          getPrivilegeBadgeClass(role)
                        )}
                      >
                        <PrivilegedIcon className="h-2.5 w-2.5" />
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="profile-menu"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className={cn(
              "absolute z-50 w-[210px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl",
              isCollapsed ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-2"
            )}
          >
            <div className="border-b border-border/80 bg-slate-50/85 px-3 py-3">
              <div className="truncate text-[0.92rem] font-semibold text-slate-900">
                {currentUser ? getUserDisplayName(currentUser) : labels.loading}
              </div>
              <div className="truncate pt-0.5 text-[0.76rem] text-slate-500">
                {currentUser?.email || ""}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge
                  variant="outline"
                  className="h-5 rounded-full border-border/80 bg-white text-[10px] font-semibold tracking-[0.01em] text-slate-600"
                >
                  {roleLabel}
                </Badge>
                {currentUser?.privileged_roles?.map((role) => (
                  <Badge
                    key={role}
                    variant="outline"
                    className={cn(
                      "h-5 rounded-full text-[10px] font-semibold tracking-[0.01em]",
                      getPrivilegeBadgeClass(role)
                    )}
                  >
                    {getPrivilegedRoleLabel(role, language)}
                  </Badge>
                ))}
              </div>
            </div>
            <ul className="space-y-0.5 px-2 pb-2">
              {menuItems.map((item) => {
                if (item.id === "divider") {
                  return <li key="divider" className="my-1 border-t border-border/90" />;
                }

                const showIndicator =
                  hoveredItem !== null
                    ? hoveredItem === item.id
                    : activeItem === item.id;

                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn(
                        "relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.95rem] transition-colors",
                        item.destructive
                          ? "text-red-600 hover:text-red-700"
                          : "text-foreground/90 hover:text-foreground"
                      )}
                      onMouseEnter={() => setHoveredItem(item.id)}
                      onMouseLeave={() => setHoveredItem(null)}
                      onClick={() => {
                        setIsOpen(false);
                        item.onSelect();
                      }}
                    >
                      {showIndicator && (
                        <motion.span
                          layoutId="sidebar-user-menu-indicator"
                          className={cn(
                            "absolute inset-0 rounded-lg",
                            item.destructive ? "bg-red-50" : "bg-muted"
                          )}
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 32,
                            mass: 0.75,
                          }}
                        />
                      )}
                      <HugeiconsIcon
                        icon={item.icon}
                        className="relative z-10 size-[17px]"
                      />
                      <span className="relative z-10 font-medium">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DashboardSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const language = useLanguageStore((state) => state.language);
  const t = SIDEBAR_LABELS[language];
  const token = useAuthStore((state) => state.token);
  const userRole = useAuthStore((state) => state.role);
  const clearSessionState = useAuthStore((state) => state.clearSessionState);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchCurrentUser(token)
      .then((user) => { if (!cancelled) setCurrentUser(user); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, pathname, setOpenMobile]);

  const showMeetings = canViewClinicalData(userRole);
  const navRoutes = useMemo(
    () => [
      ...baseRoutes,
      ...(showMeetings ? [meetingsRoute] : []),
      ...(canManageUsers(userRole) ? adminOnlyRoutes : []),
    ],
    [showMeetings, userRole]
  );

  useEffect(() => {
    navRoutes.forEach((route) => {
      router.prefetch(route.link);
    });
  }, [navRoutes, router]);

  const isActive = (link: string) => {
    if (link === "/overview") return pathname === "/overview" || pathname === "/";
    return pathname.startsWith(link);
  };

  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleRouteChange = (link: string) => {
    closeMobileSidebar();
    router.push(link);
  };

  const handleLogout = () => {
    closeMobileSidebar();
    clearSessionState();
    router.replace("/login");
    window.location.assign(getAdminSsoLogoutPath());
  };
  const isCollapsed = state === "collapsed";
  const activeProfileMenuItem: ProfileMenuItem | null = pathname.startsWith("/settings")
    ? "settings"
    : pathname.startsWith("/profile")
      ? "profile"
      : null;

  return (
    <Sidebar collapsible="icon" className="lg:border-r-0!" {...props}>
      {/* ── Header: Logo ── */}
      <SidebarHeader className={cn(
        "pb-0 transition-all duration-200",
        isCollapsed ? "px-2 pt-4" : "p-3 sm:p-4 lg:p-5"
      )}>
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-2")}>
          <Logo className={cn("transition-all duration-200", isCollapsed ? "h-14 w-14" : "h-12 w-12")} />
          {!isCollapsed && <span className="font-semibold text-lg sm:text-xl">E Med Help</span>}
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
                      onFocus={() => router.prefetch(route.link)}
                      onMouseEnter={() => router.prefetch(route.link)}
                      onClick={() => handleRouteChange(route.link)}
                      className={cn(
                        "group/route h-9 border border-sidebar-border/60 bg-white/65 px-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[padding,border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-[1px] hover:border-sidebar-border hover:bg-white hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)] active:translate-y-px active:shadow-[0_2px_6px_rgba(15,23,42,0.08)] sm:h-[38px] data-[active=true]:border-sidebar-border data-[active=true]:bg-sidebar-accent/85 data-[active=true]:shadow-[0_0_0_1px_hsl(var(--sidebar-border)),0_10px_22px_rgba(15,23,42,0.08)]",
                        isCollapsed && "justify-center px-0"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute inset-y-1.5 left-1 rounded-full bg-sidebar-primary transition-[opacity,transform] duration-200",
                          isCollapsed ? "w-0" : "w-1",
                          active
                            ? "opacity-100 scale-y-100"
                            : "opacity-0 scale-y-60 group-hover/route:opacity-75 group-hover/route:scale-y-100"
                        )}
                      />
                      <span
                        className={cn(
                          "relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition-[transform,background-color,color,box-shadow] duration-200",
                          active
                            ? "border-sidebar-primary/20 bg-white/70 text-sidebar-primary shadow-[0_8px_18px_rgba(73,136,196,0.18)]"
                            : "border-transparent bg-sidebar-accent/35 text-sidebar-foreground/80 group-hover/route:scale-[1.04] group-hover/route:bg-white group-hover/route:text-sidebar-primary group-hover/route:shadow-[0_6px_14px_rgba(73,136,196,0.12)]"
                        )}
                      >
                        <Icon className="size-4 sm:size-5" />
                      </span>
                      {!isCollapsed && (
                        <span className="relative z-10 text-[0.95rem] transition-transform duration-200 group-hover/route:translate-x-0.5">
                          {getRouteTitle(route.id, language)}
                        </span>
                      )}
                      {!isCollapsed && active && (
                        <ChevronRight className="relative z-10 ml-auto size-4 text-sidebar-primary opacity-80 transition-transform duration-200 group-hover/route:translate-x-0.5" />
                      )}
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
              className={cn(
                "group/help h-9 border border-sidebar-border/60 bg-white/65 px-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-[1px] hover:border-sidebar-border hover:bg-white hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)] active:translate-y-px active:shadow-[0_2px_6px_rgba(15,23,42,0.08)] sm:h-[38px]",
                isCollapsed && "justify-center px-0"
              )}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent/35 text-sidebar-foreground/80 transition-[transform,background-color,color,box-shadow] duration-200 group-hover/help:scale-[1.04] group-hover/help:bg-white group-hover/help:text-sidebar-primary group-hover/help:shadow-[0_6px_14px_rgba(73,136,196,0.12)]">
                <HelpCircle className="size-4 sm:size-5" />
              </span>
              {!isCollapsed && (
                <span className="text-[0.95rem] transition-transform duration-200 group-hover/help:translate-x-0.5">
                  {t.helpCenter}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarUserMenu
          isCollapsed={isCollapsed}
          currentUser={currentUser}
          roleLabel={currentUser ? getRoleLabel(currentUser.role, language) : t.account}
          language={language}
          labels={t}
          activeItem={activeProfileMenuItem}
          onProfile={() => {
            closeMobileSidebar();
            router.push("/profile");
          }}
          onSettings={() => {
            closeMobileSidebar();
            router.push("/settings");
          }}
          onLogout={handleLogout}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
