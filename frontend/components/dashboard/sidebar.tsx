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
  ChevronsUpDown,
  ChevronRight,
  Activity,
  Cpu,
  Stethoscope,
} from "lucide-react";
import { useEffect, useMemo, useState, startTransition } from "react";
import { Logo } from "@/components/ui/logo";
import { useSessionLogout } from "@/hooks/use-session-logout";
import { useAuthStore } from "@/store/auth-store";
import {
  canManageUsers,
  canViewClinicalData,
  fetchCurrentUser,
  UserMe,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  isMeetingCallHref,
  requestMeetingCallNavigation,
} from "@/lib/meeting-call-navigation";
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

const deviceOperationsRoute: NavItem = {
  id: "device-operations",
  icon: Stethoscope,
  link: "/device-operations",
};

const adminOnlyRoutes: NavItem[] = [
  { id: "users", icon: UserCog, link: "/users" },
  { id: "device-monitor", icon: Activity, link: "/device-monitor" },
  { id: "device-registry", icon: Cpu, link: "/device-registry" },
  { id: "audit-logs", icon: ScrollText, link: "/audit-logs" },
];

const COLLAPSED_RAIL_ITEM_CLASS =
  "mx-auto size-10! shrink-0 flex items-center justify-center gap-0! p-0! overflow-hidden";

const SIDEBAR_LABELS: Record<
  AppLanguage,
  {
    routes: Record<string, string>;
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
      "patient-trends": "Patient Trends",
      meetings: "Meetings",
      "device-operations": "Device Operations",
      users: "Users",
      "device-monitor": "Device Monitor",
      "device-registry": "Device Registry",
      "audit-logs": "Audit Logs",
    },
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
      "patient-trends": "แนวโน้มผู้ป่วย",
      meetings: "การนัดหมาย",
      "device-operations": "ปฏิบัติการอุปกรณ์",
      users: "ผู้ใช้",
      "device-monitor": "มอนิเตอร์อุปกรณ์",
      "device-registry": "ทะเบียนอุปกรณ์",
      "audit-logs": "บันทึก Audit",
    },
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
    <div
      ref={containerRef}
      className={cn("relative", isCollapsed ? "w-10" : "w-full")}
    >
      <button
        id="sidebar-user-menu-button"
        type="button"
        className={cn(
          "cursor-pointer rounded-lg text-left transition-colors hover:bg-accent",
          isCollapsed
            ? cn("flex", COLLAPSED_RAIL_ITEM_CLASS)
            : "flex w-full items-center gap-2 p-2 sm:gap-3 sm:p-3",
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
          <AvatarFallback
            className="text-[0.82rem]"
            seed={currentUser ? `${currentUser.id}|${currentUser.email}|${getUserDisplayName(currentUser)}` : "sidebar-user"}
          >
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
  const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const language = useLanguageStore((state) => state.language);
  const t = SIDEBAR_LABELS[language];
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.userId);
  const currentUser = useAuthStore((state) => state.currentUser);
  const userRole = useAuthStore((state) => state.role);
  const setCurrentUser = useAuthStore((state) => state.setCurrentUser);
  const logoutSession = useSessionLogout();
  const resolvedCurrentUser =
    userId && currentUser?.id === userId ? currentUser : null;

  useEffect(() => {
    if (!token || !userId) {
      return;
    }

    let cancelled = false;
    const loadCurrentUser = () => {
      fetchCurrentUser(token)
        .then((user) => {
          if (!cancelled && user.id === userId) {
            setCurrentUser(user);
          }
        })
        .catch(() => {
          // silent
        });
    };

    loadCurrentUser();
    const handleProfileUpdated = () => {
      loadCurrentUser();
    };

    window.addEventListener("telemed-profile-updated", handleProfileUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener("telemed-profile-updated", handleProfileUpdated);
    };
  }, [setCurrentUser, token, userId]);

  useEffect(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, pathname, setOpenMobile]);

  const showMeetings = canViewClinicalData(userRole);
  const isAdmin = userRole === "admin";
  const navRoutes = useMemo(
    () => [
      ...baseRoutes,
      ...(showMeetings ? [meetingsRoute] : []),
      ...(isAdmin ? [deviceOperationsRoute] : []),
      ...(canManageUsers(userRole) ? adminOnlyRoutes : []),
    ],
    [isAdmin, showMeetings, userRole]
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
    if (isMeetingCallHref(pathname) && !isMeetingCallHref(link)) {
      requestMeetingCallNavigation(link);
      return;
    }
    startTransition(() => {
      router.push(link);
    });
  };

  const handleLogout = () => {
    closeMobileSidebar();
    logoutSession();
  };
  const isCollapsed = state === "collapsed";
  const activeProfileMenuItem: ProfileMenuItem | null =
    pathname.startsWith("/settings") || pathname.startsWith("/profile")
      ? "settings"
      : null;
  const handleSidebarSurfaceClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest(
          "a, button, input, textarea, select, [role='button'], [role='menuitem']"
        )
      ) {
        return;
      }

      toggleSidebar();
    },
    [toggleSidebar]
  );

  return (
    <Sidebar
      collapsible="icon"
      className="cursor-ew-resize lg:border-r-0! group-data-[collapsible=icon]:border-r-0 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:overflow-hidden group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:rounded-[18px] group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:border group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:border-slate-200/70 group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:bg-white group-data-[collapsible=icon]:[&_[data-slot=sidebar-inner]]:shadow-[0_10px_34px_rgba(15,23,42,0.08)]"
      onClick={handleSidebarSurfaceClick}
      {...props}
    >
      {/* ── Header: Logo ── */}
      <SidebarHeader className={cn(
        "pb-0 transition-[padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        isCollapsed ? "px-0 pt-3" : "p-3 sm:p-4 lg:p-5"
      )}>
        <div className={cn(
          "flex min-w-0 items-center transition-[gap,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          isCollapsed
            ? COLLAPSED_RAIL_ITEM_CLASS
            : "w-full justify-start gap-2"
        )}>
          <Logo
            className={cn(
              "shrink-0 transition-[width,height,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              isCollapsed ? "size-9" : "h-12 w-12"
            )}
          />
          <span
            aria-hidden={isCollapsed}
            className={cn(
              "block overflow-hidden whitespace-nowrap text-lg font-semibold transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:text-xl",
              isCollapsed
                ? "max-w-0 -translate-x-1 opacity-0"
                : "max-w-40 translate-x-0 opacity-100"
            )}
          >
            E Med Help
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className={cn(
        "transition-[padding] duration-200",
        isCollapsed ? "items-center px-0" : "px-3 sm:px-4 lg:px-5"
      )}>
        {/* ── Menu ── */}
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className={cn(isCollapsed && "items-center")}>
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
                        "h-10 rounded-xl border border-transparent bg-transparent px-2.5 text-sidebar-foreground/80 shadow-none transition-[background-color,color,padding,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground active:scale-[0.99] sm:h-10 data-[active=true]:bg-sidebar-accent/80 data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-none",
                        isCollapsed &&
                          cn(
                            COLLAPSED_RAIL_ITEM_CLASS,
                            "rounded-xl text-slate-800 hover:bg-slate-100 data-[active=true]:bg-[#e8f7ff] data-[active=true]:text-[#083b66]"
                          )
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-[width,height,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                          isCollapsed &&
                            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                          !isCollapsed && "sm:size-5"
                        )}
                      />
                      <span
                        className={cn(
                          "block min-w-0 overflow-hidden whitespace-nowrap text-[0.95rem] transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                          isCollapsed
                            ? "max-w-0 -translate-x-1 opacity-0"
                            : "max-w-44 translate-x-0 opacity-100"
                        )}
                      >
                        {getRouteTitle(route.id, language)}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          "h-4 shrink-0 text-muted-foreground transition-[margin,width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                          active && !isCollapsed
                            ? "ml-auto w-4 translate-x-0 opacity-55"
                            : "ml-0 w-0 -translate-x-1 opacity-0"
                        )}
                      />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer: User Profile ── */}
      <SidebarFooter className={cn(
        "pb-3 transition-[padding] duration-200 sm:pb-4 lg:pb-5",
        isCollapsed ? "items-center px-0" : "px-3 sm:px-4 lg:px-5"
      )}>
        <SidebarUserMenu
          isCollapsed={isCollapsed}
          currentUser={resolvedCurrentUser}
          labels={t}
          activeItem={activeProfileMenuItem}
          onSettings={() => {
            closeMobileSidebar();
            if (isMeetingCallHref(pathname)) {
              requestMeetingCallNavigation("/settings?panel=account");
              return;
            }
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
