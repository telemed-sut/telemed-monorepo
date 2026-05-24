import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import type { CSSProperties, ReactNode } from "react";

const appShellSidebarStyle = {
	"--sidebar-width-icon": "3rem",
} as CSSProperties;

export function AppShell({
	children,
	serverRole,
	sidebarDefaultOpen,
}: {
	children: ReactNode;
	serverRole: string | null;
	sidebarDefaultOpen: boolean;
}) {
	return (
		<div className="dark overflow-hidden">
			<SidebarProvider
				className="relative h-svh"
				defaultOpen={sidebarDefaultOpen}
				style={appShellSidebarStyle}
			>
				<AppSidebar serverRole={serverRole} />
				<SidebarInset className="md:peer-data-[variant=inset]:ml-0">
					<AppHeader />
					<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
						{children}
					</div>
				</SidebarInset>
			</SidebarProvider>
		</div>
	);
}
