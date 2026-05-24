"use client";

import { useRouter } from "next/navigation";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AccountSetting01Icon,
	Logout02Icon,
	Notification03Icon,
	SecurityCheckIcon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { useAuthStore } from "@/store/auth-store";
import { useSessionLogout } from "@/hooks/use-session-logout";
import { getRoleLabel } from "@/lib/api";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const labels: Record<
	AppLanguage,
	{
		loading: string;
		profile: string;
		notifications: string;
		accountSecurity: string;
		settings: string;
		logOut: string;
	}
> = {
	en: {
		loading: "Loading...",
		profile: "Profile",
		notifications: "Notifications",
		accountSecurity: "Account security",
		settings: "Settings",
		logOut: "Log out",
	},
	th: {
		loading: "กำลังโหลด...",
		profile: "โปรไฟล์",
		notifications: "การแจ้งเตือน",
		accountSecurity: "ความปลอดภัยบัญชี",
		settings: "ตั้งค่า",
		logOut: "ออกจากระบบ",
	},
};

function getUserDisplayName(user: ReturnType<typeof useAuthStore.getState>["currentUser"]): string {
	if (!user) return "";
	if (user.first_name || user.last_name) {
		return [user.first_name, user.last_name].filter(Boolean).join(" ");
	}
	return user.email.split("@")[0];
}

function getUserInitials(user: ReturnType<typeof useAuthStore.getState>["currentUser"]): string {
	if (!user) return "--";
	if (user.first_name && user.last_name) {
		return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
	}
	if (user.first_name) return user.first_name.slice(0, 2).toUpperCase();
	return user.email.slice(0, 2).toUpperCase();
}

export function NavUser() {
	const router = useRouter();
	const logout = useSessionLogout();
	const language = useLanguageStore((state) => state.language);
	const currentUser = useAuthStore((state) => state.currentUser);
	const role = useAuthStore((state) => state.role);
	const t = labels[language];
	const userName = currentUser ? getUserDisplayName(currentUser) : t.loading;
	const userEmail = currentUser?.email ?? "";
	const userSecondaryLabel = userEmail || getRoleLabel(role ?? "", language);
	const avatarSeed = currentUser?.email ?? "emed-help";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger nativeButton={false} render={<Avatar className="size-8" />}>
				<AvatarImage src={`https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(avatarSeed)}`} />
				<AvatarFallback>{getUserInitials(currentUser)}</AvatarFallback>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl p-1.5">
				<DropdownMenuLabel className="flex min-w-0 items-start gap-3 rounded-lg p-2.5 text-left">
					<Avatar className="mt-0.5 size-10 shrink-0">
						<AvatarImage src={`https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(avatarSeed)}`} />
						<AvatarFallback>{getUserInitials(currentUser)}</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1">
						<div className="truncate font-medium text-foreground">{userName}</div>
						<div
							className="mt-0.5 max-w-full break-all text-muted-foreground text-xs leading-5"
							title={userSecondaryLabel}
						>
							{userSecondaryLabel}
						</div>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem onClick={() => router.push("/profile")}>
						<HugeiconsIcon icon={UserMultipleIcon} strokeWidth={2} />
						{t.profile}
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem onClick={() => router.push("/settings?panel=security")}>
						<HugeiconsIcon icon={SecurityCheckIcon} strokeWidth={2} />
						{t.accountSecurity}
					</DropdownMenuItem>
					<DropdownMenuItem>
						<HugeiconsIcon icon={Notification03Icon} strokeWidth={2} />
						{t.notifications}
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem onClick={() => router.push("/settings")}>
						<HugeiconsIcon icon={AccountSetting01Icon} strokeWidth={2} />
						{t.settings}
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						className="w-full cursor-pointer"
						onClick={() => void logout()}
						variant="destructive"
					>
						<HugeiconsIcon icon={Logout02Icon} strokeWidth={2} />
						{t.logOut}
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
