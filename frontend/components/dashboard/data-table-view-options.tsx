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

interface DataTableViewOptionsProps<TData> {
    table: Table<TData>;
}

export function DataTableViewOptions<TData>({
    table,
}: DataTableViewOptionsProps<TData>) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="ml-auto hidden h-8 lg:flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground px-3 text-xs font-medium focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50">
                <Settings2 className="mr-2 h-4 w-4" />
                View
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[150px]">
                <DropdownMenuGroup>
                    <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
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
