"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger";
import { getNavLinks } from "@/components/app-shared";
import { NavUser } from "@/components/nav-user";
import { HugeiconsIcon } from "@hugeicons/react";
import { LanguageCircleIcon } from "@hugeicons/core-free-icons";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_LANGUAGE_OPTIONS, type AppLanguage } from "@/store/language-config";
import { useLanguageStore } from "@/store/language-store";

const labels: Record<AppLanguage, { language: string }> = {
	en: {
		language: "Language",
	},
	th: {
		language: "ภาษา",
	},
};

export function AppHeader() {
	const pathname = usePathname();
	const language = useLanguageStore((state) => state.language);
	const setLanguage = useLanguageStore((state) => state.setLanguage);
	const activeItem = getNavLinks(language).find((item) =>
		item.path === "/overview"
			? pathname === "/" || pathname === "/overview"
			: Boolean(item.path && pathname.startsWith(item.path))
	);
	const t = labels[language];

	return (
		<header
			className={cn(
				"sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 md:px-6"
			)}
		>
			<div className="flex items-center gap-3">
				<CustomSidebarTrigger />
				<Separator
					className="mr-2 h-4 data-[orientation=vertical]:self-center"
					orientation="vertical"
				/>
				<AppBreadcrumbs page={activeItem} />
			</div>
			<div className="flex items-center gap-3">
				<DropdownMenu>
					<DropdownMenuTrigger render={<Button aria-label={t.language} size="icon-sm" variant="outline" />}>
						<HugeiconsIcon icon={LanguageCircleIcon} strokeWidth={2} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-40">
						<DropdownMenuLabel>{t.language}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{APP_LANGUAGE_OPTIONS.map((option) => (
							<DropdownMenuItem key={option.value} onClick={() => setLanguage(option.value)}>
								{option.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
				<Separator
					className="h-4 data-[orientation=vertical]:self-center"
					orientation="vertical"
				/>
				<NavUser />
			</div>
		</header>
	);
}
