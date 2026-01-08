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
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar";
import { ChevronsUpDown, Plus } from "lucide-react";
import * as React from "react";
import { useAuthStore } from "@/store/auth-store";
import { useRouter } from "next/navigation";
import { Settings01Icon, Logout01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";


type Team = {
    name: string;
    logo: React.ElementType;
    plan: string;
};

export function TeamSwitcher({ teams }: { teams: Team[] }) {
    const { isMobile } = useSidebar();
    const [activeTeam, setActiveTeam] = React.useState(teams[0]);
    const clearToken = useAuthStore((state) => state.clearToken);
    const router = useRouter();

    React.useEffect(() => {
        if (teams.length > 0) {
            setActiveTeam(teams[0]);
        }
    }, [teams]);


    if (!activeTeam) return null;

    const Logo = activeTeam.logo;

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        className="ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground gap-2 rounded-md p-2 text-left text-sm transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 data-active:font-medium peer/menu-button flex w-full items-center overflow-hidden outline-hidden group/menu-button disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&_svg]:size-4 [&_svg]:shrink-0 h-12 group-data-[collapsible=icon]:p-0! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    >
                        <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-background text-foreground">
                            <Logo className="size-4" />
                        </div>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-semibold">
                                {activeTeam.name}
                            </span>
                            <span className="truncate text-xs">{activeTeam.plan}</span>
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
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                                Teams
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
                            className="gap-2 p-2 cursor-pointer"
                            onClick={() => {
                                // Placeholder for Settings
                            }}
                        >
                            <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                                <HugeiconsIcon icon={Settings01Icon} className="size-4" />
                            </div>
                            <div className="font-medium text-muted-foreground">Settings</div>
                        </DropdownMenuItem>

                        <DropdownMenuItem
                            className="gap-2 p-2 cursor-pointer text-destructive focus:text-destructive"
                            onClick={() => {
                                clearToken();
                                router.replace("/login");
                            }}
                        >
                            <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                                <HugeiconsIcon icon={Logout01Icon} className="size-4" />
                            </div>
                            <div className="font-medium">Logout</div>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
