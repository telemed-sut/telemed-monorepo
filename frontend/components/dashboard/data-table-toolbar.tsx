"use client";

import { Table } from "@tanstack/react-table";
import { X, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/dashboard/data-table-view-options";

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    onSearch?: (value: string) => void;
    searchPlaceholder?: string;
    onBulkDelete?: (selectedIds: string[]) => void;
    filterComponent?: React.ReactNode;
}

export function DataTableToolbar<TData>({
    table,
    onSearch,
    searchPlaceholder = "Search...",
    onBulkDelete,
    filterComponent,
}: DataTableToolbarProps<TData>) {
    const isFiltered = table.getState().columnFilters.length > 0;
    const selectedRows = table.getFilteredSelectedRowModel().rows;
    const selectedIds = selectedRows.map((row) => (row.original as any).id);

    return (
        <div className="flex items-center justify-between">
            <div className="flex flex-1 items-center space-x-2">
                {onSearch && (
                    <Input
                        placeholder={searchPlaceholder}
                        onChange={(event) => onSearch(event.target.value)}
                        className="h-8 w-[150px] lg:w-[250px]"
                    />
                )}
                {filterComponent}
                {isFiltered && (
                    <Button
                        variant="ghost"
                        onClick={() => table.resetColumnFilters()}
                        className="h-8 px-2 lg:px-3"
                    >
                        Reset
                        <X className="ml-2 h-4 w-4" />
                    </Button>
                )}
            </div>

            {selectedIds.length > 0 && onBulkDelete && (
                <Button
                    variant="destructive"
                    size="sm"
                    className="mr-2 h-8"
                    onClick={() => onBulkDelete(selectedIds)}
                >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete ({selectedIds.length})
                </Button>
            )}

            <DataTableViewOptions table={table} />
        </div>
    );
}
