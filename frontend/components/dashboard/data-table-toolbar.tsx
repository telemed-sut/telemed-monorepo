"use client";

import { Table } from "@tanstack/react-table";
import { X, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableViewOptions } from "@/components/dashboard/data-table-view-options";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const tr = (language: AppLanguage, en: string, th: string) =>
    language === "th" ? th : en;

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
    searchPlaceholder,
    onBulkDelete,
    filterComponent,
}: DataTableToolbarProps<TData>) {
    const language = useLanguageStore((state) => state.language);
    const isFiltered = table.getState().columnFilters.length > 0;
    const selectedRows = table.getFilteredSelectedRowModel().rows;
    const selectedIds = selectedRows
        .map((row) => {
            const record = row.original as Record<string, unknown>;
            return typeof record.id === "string" ? record.id : null;
        })
        .filter((id): id is string => id !== null);

    return (
        <div className="flex items-center justify-between">
            <div className="flex flex-1 items-center space-x-2">
                {onSearch && (
                    <Input
                        placeholder={searchPlaceholder ?? tr(language, "Search...", "ค้นหา...")}
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
                        {tr(language, "Reset", "รีเซ็ต")}
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
                    {tr(language, `Delete (${selectedIds.length})`, `ลบ (${selectedIds.length})`)}
                </Button>
            )}

            <DataTableViewOptions table={table} />
        </div>
    );
}
