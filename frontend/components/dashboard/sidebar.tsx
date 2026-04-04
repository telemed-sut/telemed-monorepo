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
} from "lucide-react";
import { useEffect, useMemo, useState, startTransition } from "react";
import { Logo } from "@/components/ui/logo";
import { useAuthStore } from "@/store/auth-store";
import {
  canManageUsers,
  canViewClinicalData,
  fetchCurrentUser,
  logout,
  UserMe,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguageStore } from "@/store/language-store";
import { type AppLanguage } from "@/store/language-config";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Logout01Icon,
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
    accountSettings: string;
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
    accountSettings: "Account & settings",
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
    accountSettings: "บัญชีและตั้งค่า",
    profile: "โปรไฟล์",
    settings: "ตั้งค่า",
    logOut: "ออกจากระบบ",
  },
};

function getRouteTitle(routeId: string, language: AppLanguage): string {
  return SIDEBAR_LABELS[language].routes[routeId] || routeId;
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

type ProfileMenuItem = "settings" | "logout";

function SidebarUserMenu({
  isCollapsed,
  currentUser,
  labels,
  activeItem,
  onSettings,
  onLogout,
}: {
  isCollapsed: boolean;
  currentUser: UserMe | null;
  labels: {
    loading: string;
    accountSettings: string;
    settings: string;
    logOut: string;
  };
  activeItem: ProfileMenuItem | null;
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
    { id: "settings", label: labels.accountSettings, icon: UserIcon, onSelect: onSettings },
    { id: "divider" },
    { id: "logout", label: labels.logOut, icon: Logout01Icon, onSelect: onLogout, destructive: true },
  ];

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        id="sidebar-user-menu-button"
        type="button"
        className={cn(
          "w-full cursor-pointer rounded-lg p-2 text-left transition-colors hover:bg-accent sm:p-3",
          isCollapsed ? "flex justify-center" : "flex items-center gap-2 sm:gap-3",
          isOpen && "bg-accent"
        )}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Avatar className="size-8 sm:size-9">
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
            <div className="min-w-0 flex flex-1 items-center gap-2">
              <p className="truncate text-sm font-semibold sm:text-[0.95rem]">
                {currentUser ? getUserDisplayName(currentUser) : labels.loading}
              </p>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
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
            <div className="px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {currentUser ? getUserDisplayName(currentUser) : labels.loading}
                </p>
                {currentUser?.email ? (
                  <p className="truncate text-[0.82rem] text-muted-foreground">
                    {currentUser.email}
                  </p>
                ) : null}
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
                        "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.95rem] transition-colors",
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
  const clearToken = useAuthStore((state) => state.clearToken);
  const [currentUser, setCurrentUser] = useState<UserMe | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const loadCurrentUser = () => {
      fetchCurrentUser(token)
        .then((user) => {
          if (!cancelled) setCurrentUser(user);
        })
        .catch(() => {
          // silent
        });
    };

    loadCurrentUser();
    window.addEventListener("telemed-profile-updated", loadCurrentUser);

    return () => {
      cancelled = true;
      window.removeEventListener("telemed-profile-updated", loadCurrentUser);
    };
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
    startTransition(() => {
      router.push(link);
    });
  };

  const handleLogout = () => {
    closeMobileSidebar();
    void logout(token || undefined).catch(() => undefined).finally(() => {
      clearToken();
      router.replace("/login");
    });
  };
  const isCollapsed = state === "collapsed";
  const activeProfileMenuItem: ProfileMenuItem | null =
    pathname.startsWith("/settings") || pathname.startsWith("/profile")
      ? "settings"
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
                        "h-9 border border-sidebar-border/60 transition-[padding,border-color,background-color] duration-200 hover:border-sidebar-border sm:h-[38px] data-[active=true]:border-sidebar-border data-[active=true]:shadow-[0_0_0_1px_hsl(var(--sidebar-border))]",
                        isCollapsed && "justify-center px-0"
                      )}
                    >
                      <Icon className="size-4 sm:size-5" />
                      {!isCollapsed && (
                        <span className="text-[0.95rem]">{getRouteTitle(route.id, language)}</span>
                      )}
                      {!isCollapsed && active && (
                        <ChevronRight className="ml-auto size-4 text-muted-foreground opacity-60" />
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
              className={cn("h-9 sm:h-[38px]", isCollapsed && "justify-center px-0")}
            >
              <HelpCircle className="size-4 sm:size-5" />
              {!isCollapsed && <span className="text-[0.95rem]">{t.helpCenter}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarUserMenu
          isCollapsed={isCollapsed}
          currentUser={currentUser}
          labels={t}
          activeItem={activeProfileMenuItem}
          onSettings={() => {
            closeMobileSidebar();
            startTransition(() => {
              router.push("/settings?panel=account");
            });
          }}
          onLogout={handleLogout}
        />
      </SidebarFooter>
    </Sidebar>
  );
}
