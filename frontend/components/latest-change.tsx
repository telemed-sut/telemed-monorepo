"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const latestChanges: Record<
	AppLanguage,
	{
		badge: string;
		title: string;
		description: string;
		collapsedLabel: string;
		closeLabel: string;
		readMore: { href: string; label: string };
	}
> = {
	en: {
		badge: "SECURE",
		title: "E Med Help SUT",
		description: "Protected telemedicine dashboard.", // TIP: Use a single line of text for the description. (max 5 words)
		collapsedLabel: "Website info",
		closeLabel: "Collapse website info",
		readMore: { href: "/overview", label: "Open overview" },
	},
	th: {
		badge: "SECURE",
		title: "E Med Help SUT",
		description: "แดชบอร์ดแพทย์ทางไกลปลอดภัย",
		collapsedLabel: "ข้อมูลเว็บ",
		closeLabel: "ยุบข้อมูลเว็บ",
		readMore: { href: "/overview", label: "เปิดภาพรวม" },
	},
};

export function LatestChange() {
	const [isOpen, setIsOpen] = useState(true);
	const language = useLanguageStore((state) => state.language);
	const latestChange = latestChanges[language];

	if (!isOpen) {
		return (
			<Button
				aria-label={latestChange.collapsedLabel}
				className="w-full justify-start group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
				onClick={() => setIsOpen(true)}
				size="sm"
				variant="outline"
			>
				<HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} data-icon="inline-start" />
				<span className="group-data-[collapsible=icon]:hidden">
					{latestChange.collapsedLabel}
				</span>
			</Button>
		);
	}

	return (
		<div
			className={cn(
				"rounded-2xl group/latest-change size-full min-h-27 justify-center border bg-background",
				"relative flex size-full flex-col gap-1 overflow-hidden px-4 pt-3 pb-1 *:text-nowrap",
				"transition-opacity group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0"
			)}
		>
			<span className="font-light font-mono text-[10px] text-muted-foreground">
				{latestChange.badge}
			</span>
			<p className="font-medium text-xs">{latestChange.title}</p>
			<span className="text-[10px] text-muted-foreground">
				{latestChange.description}
			</span>
			<Button className="w-max px-0 font-light text-xs" size="sm" variant="link" render={<a href={latestChange.readMore.href} />} nativeButton={false}>{latestChange.readMore.label}</Button>
			<Button
				aria-label={latestChange.closeLabel}
				className="absolute top-2 right-2 z-10 size-6 rounded-full opacity-0 transition-opacity group-hover/latest-change:opacity-100"
				onClick={() => setIsOpen(false)}
				size="icon-sm"
				variant="ghost"
			>
				<HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5 text-muted-foreground" />{" "}
			</Button>
		</div>
	);
}
