"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/ui/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { NavGroup } from "@/components/nav-group";
import { getFooterNavLinks, getNavGroups } from "@/components/app-shared";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";
import { useAuthStore } from "@/store/auth-store";
import { canManageUsers, canViewClinicalData } from "@/lib/api";

const labels: Record<
	AppLanguage,
	{
		brand: string;
	}
> = {
	en: {
		brand: "E Med Help",
	},
	th: {
		brand: "E Med Help",
	},
};

export function AppSidebar({ serverRole }: { serverRole: string | null }) {
	const pathname = usePathname();
	const language = useLanguageStore((state) => state.language);
	const clientRole = useAuthStore((state) => state.role);
	const hydrated = useAuthStore((state) => state.hydrated);
	const role = hydrated ? clientRole : serverRole;
	const t = labels[language];
	const isAdmin = canManageUsers(role);
	const canUseClinicalRoutes = canViewClinicalData(role);
	const navGroupsWithActive = getNavGroups(language).map((group) => ({
		...group,
		items: group.items
			.filter((item) => {
				if (item.requiresAdmin) return isAdmin;
				if (item.requiresClinicalAccess) return canUseClinicalRoutes;
				return true;
			})
			.map((item) => ({
				...item,
				isActive:
					item.path === "/overview"
						? pathname === "/" || pathname === "/overview"
						: Boolean(item.path && pathname.startsWith(item.path)),
				subItems: item.subItems?.map((subItem) => ({
					...subItem,
					isActive: Boolean(subItem.path && pathname.startsWith(subItem.path)),
				})),
			})),
	})).filter((group) => group.items.length > 0);
	const footerNavLinks = getFooterNavLinks(language).map((item) => ({
		...item,
		isActive: Boolean(item.path && pathname.startsWith(item.path)),
	}));

	return (
		<Sidebar collapsible="icon" variant="inset">
			<SidebarHeader className="h-14 justify-center">
				<SidebarMenuButton render={<Link href="/overview" />}>
					<Logo className="size-5 shrink-0" />
					<span className="font-medium group-data-[collapsible=icon]:hidden">
						{t.brand}
					</span>
				</SidebarMenuButton>
			</SidebarHeader>
			<SidebarContent>
				{navGroupsWithActive.map((group, index) => (
					<NavGroup key={`sidebar-group-${index}`} {...group} />
				))}
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					{footerNavLinks.map((item) => (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton className="text-muted-foreground" isActive={item.isActive} size="sm" render={<Link href={item.path ?? "#"} />}>
								{item.icon}
								<span className="group-data-[collapsible=icon]:hidden">
									{item.title}
								</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
