import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ActivityIcon,
	Audit01Icon,
	Calendar01Icon,
	CpuIcon,
	DashboardSquare01Icon,
	Hospital01Icon,
	SecurityCheckIcon,
	Settings01Icon,
	Stethoscope02Icon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import type { AppLanguage } from "@/store/language-config";

export type SidebarNavItem = {
	id: string;
	title: string;
	path?: string;
	icon?: ReactNode;
	isActive?: boolean;
	requiresClinicalAccess?: boolean;
	requiresAdmin?: boolean;
	subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
	label?: string;
	items: SidebarNavItem[];
};

const icon = (iconNode: Parameters<typeof HugeiconsIcon>[0]["icon"]) => (
	<HugeiconsIcon icon={iconNode} strokeWidth={2} />
);

const baseNavGroups: SidebarNavGroup[] = [
	{
		items: [
			{
				id: "overview",
				title: "Overview",
				path: "/overview",
				icon: icon(DashboardSquare01Icon),
			},
		],
	},
	{
		label: "Clinical",
		items: [
			{
				id: "patients",
				title: "Patients",
				path: "/patients",
				icon: icon(UserMultipleIcon),
			},
			{
				id: "meetings",
				title: "Meetings",
				path: "/meetings",
				icon: icon(Calendar01Icon),
				requiresClinicalAccess: true,
			},
			{
				id: "device-operations",
				title: "Device Operations",
				path: "/device-operations",
				icon: icon(Stethoscope02Icon),
				requiresAdmin: true,
			},
		],
	},
	{
		label: "Administration",
		items: [
			{
				id: "users",
				title: "Users",
				path: "/users",
				icon: icon(Hospital01Icon),
				requiresAdmin: true,
			},
			{
				id: "device-monitor",
				title: "Device Monitor",
				path: "/device-monitor",
				icon: icon(ActivityIcon),
				requiresAdmin: true,
			},
			{
				id: "device-registry",
				title: "Device Registry",
				path: "/device-registry",
				icon: icon(CpuIcon),
				requiresAdmin: true,
			},
			{
				id: "security",
				title: "Security",
				path: "/security",
				icon: icon(SecurityCheckIcon),
				requiresAdmin: true,
			},
			{
				id: "audit-logs",
				title: "Audit Logs",
				path: "/audit-logs",
				icon: icon(Audit01Icon),
				requiresAdmin: true,
			},
		],
	},
];

const baseFooterNavLinks: SidebarNavItem[] = [
	{
		id: "settings",
		title: "Settings",
		path: "/settings",
		icon: icon(Settings01Icon),
	},
];

const navText: Record<AppLanguage, { groups: Record<string, string>; items: Record<string, string> }> = {
	en: {
		groups: {
			Clinical: "Clinical",
			Administration: "Administration",
		},
		items: {
			overview: "Overview",
			patients: "Patients",
			meetings: "Meetings",
			"device-operations": "Device Operations",
			users: "Users",
			"device-monitor": "Device Monitor",
			"device-registry": "Device Registry",
			security: "Security",
			"audit-logs": "Audit Logs",
			settings: "Settings",
		},
	},
	th: {
		groups: {
			Clinical: "งานคลินิก",
			Administration: "ผู้ดูแลระบบ",
		},
		items: {
			overview: "ภาพรวม",
			patients: "ผู้ป่วย",
			meetings: "การนัดหมาย",
			"device-operations": "ปฏิบัติการอุปกรณ์",
			users: "ผู้ใช้",
			"device-monitor": "มอนิเตอร์อุปกรณ์",
			"device-registry": "ทะเบียนอุปกรณ์",
			security: "ความปลอดภัย",
			"audit-logs": "บันทึก Audit",
			settings: "ตั้งค่า",
		},
	},
};

function localizeItem(item: SidebarNavItem, language: AppLanguage): SidebarNavItem {
	return {
		...item,
		title: navText[language].items[item.id] ?? item.title,
		subItems: item.subItems?.map((subItem) => localizeItem(subItem, language)),
	};
}

export function getNavGroups(language: AppLanguage): SidebarNavGroup[] {
	return baseNavGroups.map((group) => ({
		...group,
		label: group.label ? navText[language].groups[group.label] ?? group.label : undefined,
		items: group.items.map((item) => localizeItem(item, language)),
	}));
}

export function getFooterNavLinks(language: AppLanguage): SidebarNavItem[] {
	return baseFooterNavLinks.map((item) => localizeItem(item, language));
}

export function getNavLinks(language: AppLanguage): SidebarNavItem[] {
	const groups = getNavGroups(language);
	const footer = getFooterNavLinks(language);

	return [
		...groups.flatMap((group) =>
			group.items.flatMap((item) =>
				item.subItems?.length ? [item, ...item.subItems] : [item]
			)
		),
		...footer,
	];
}
