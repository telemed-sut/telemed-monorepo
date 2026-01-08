"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BellIcon } from "lucide-react";

type Notification = {
    id: string;
    avatar: string;
    fallback: string;
    text: string;
    time: string;
};

export function NotificationsPopover({
    notifications,
}: {
    notifications: Notification[];
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 size-9 hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground rounded-full"
                aria-label="Open notifications"
            >
                <BellIcon className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" className="w-80 my-6">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {notifications.map(({ id, avatar, fallback, text, time }) => (
                        <DropdownMenuItem key={id} className="flex items-start gap-3">
                            <Avatar className="size-8">
                                <AvatarImage src={avatar} alt="Avatar" />
                                <AvatarFallback>{fallback}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">{text}</span>
                                <span className="text-xs text-muted-foreground">{time}</span>
                            </div>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="justify-center text-sm text-muted-foreground hover:text-primary">
                    View all notifications
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
