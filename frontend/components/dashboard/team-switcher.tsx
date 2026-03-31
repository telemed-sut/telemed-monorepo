"use client";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuGroup,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    SidebarMenu,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";
import { ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { useAuthStore } from "@/store/auth-store";
import { useRouter } from "next/navigation";
import { Logout01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getAdminSsoLogoutPath } from "@/lib/api";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";


type Team = {
    name: string;
    logo: React.ElementType;
    plan: string;
};

const tr = (language: AppLanguage, en: string, th: string) =>
    language === "th" ? th : en;

export function TeamSwitcher({ teams }: { teams: Team[] }) {
    const { isMobile } = useSidebar();
    const [activeTeam, setActiveTeam] = React.useState(teams[0]);
    const authSource = useAuthStore((state) => state.authSource);
    const clearSessionState = useAuthStore((state) => state.clearSessionState);
    const router = useRouter();
    const language = useLanguageStore((state) => state.language);

    React.useEffect(() => {
        if (teams.length > 0) {
            setActiveTeam(teams[0]);
        }
    }, [teams]);


    if (!activeTeam) return null;

    const Logo = activeTeam.logo;

    return (
        <div className="relative overflow-hidden rounded-xl bg-white/10 dark:bg-white/5 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-[4px_4px_12px_rgba(0,0,0,0.06),-4px_-4px_12px_rgba(255,255,255,0.05),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(255,255,255,0.08)]">
            <SidebarMenu>
                <SidebarMenuItem>
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            className="ring-sidebar-ring hover:bg-white/10 dark:hover:bg-white/5 active:bg-white/15 data-active:bg-white/10 data-open:hover:bg-white/10 gap-2 rounded-md p-2 text-left text-sm transition-all group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 data-active:font-medium peer/menu-button flex w-full items-center overflow-hidden outline-hidden group/menu-button disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&_svg]:size-4 [&_svg]:shrink-0 h-12 group-data-[collapsible=icon]:p-0! data-[state=open]:bg-white/10"
                        >
                            <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-white/15 dark:bg-white/10 backdrop-blur-sm border border-white/20 text-foreground">
                                <Logo className="size-9" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    {activeTeam.name}
                                </span>
                                <span className="truncate text-sm text-muted-foreground">{activeTeam.plan}</span>
                            </div>
                            <ChevronsUpDown className="ml-auto" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg mb-4"
                            align="start"
                            side={isMobile ? "bottom" : "right"}
                            sideOffset={4}
                        >
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="text-sm text-muted-foreground">
                                    {tr(language, "Teams", "ทีม")}
                                </DropdownMenuLabel>
                                {teams.map((team, index) => (
                                    <DropdownMenuItem
                                        key={team.name}
                                        onClick={() => setActiveTeam(team)}
                                        className="gap-2 p-2"
                                    >
                                        <div className="flex size-6 items-center justify-center rounded-sm border">
                                            <team.logo className="size-4 shrink-0" />
                                        </div>
                                        {team.name}
                                        <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="gap-2 p-2 cursor-pointer text-destructive focus:text-destructive"
                                onClick={() => {
                                    const isSsoSession = authSource === "sso";
                                    clearSessionState();
                                    if (isSsoSession) {
                                        window.location.assign(getAdminSsoLogoutPath());
                                        return;
                                    }
                                    router.replace("/login");
                                }}
                            >
                                <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                                    <HugeiconsIcon icon={Logout01Icon} className="size-4" />
                                </div>
                                <div className="font-medium">{tr(language, "Logout", "ออกจากระบบ")}</div>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SidebarMenuItem>
            </SidebarMenu>
        </div>
    );
}
