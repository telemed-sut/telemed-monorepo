"use client";


import { Table } from "@tanstack/react-table";
import { Settings2 } from "lucide-react";


import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const tr = (language: AppLanguage, en: string, th: string) =>
    language === "th" ? th : en;

interface DataTableViewOptionsProps<TData> {
    table: Table<TData>;
}

export function DataTableViewOptions<TData>({
    table,
}: DataTableViewOptionsProps<TData>) {
    const language = useLanguageStore((state) => state.language);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="ml-auto hidden h-8 lg:flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground px-3 text-xs font-medium focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50">
                <Settings2 className="mr-2 h-4 w-4" />
                {tr(language, "View", "มุมมอง")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[150px]">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>{tr(language, "Toggle columns", "สลับการแสดงคอลัมน์")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {table
                        .getAllColumns()
                        .filter(
                            (column) =>
                                typeof column.accessorFn !== "undefined" && column.getCanHide()
                        )
                        .map((column) => {
                            return (
                                <DropdownMenuCheckboxItem
                                    key={column.id}
                                    className="capitalize"
                                    checked={column.getIsVisible()}
                                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                                >
                                    {column.id}
                                </DropdownMenuCheckboxItem>
                            );
                        })}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
