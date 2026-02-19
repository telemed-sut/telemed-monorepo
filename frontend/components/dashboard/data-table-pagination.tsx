"use client";

import { Table } from "@tanstack/react-table";
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";

const tr = (language: AppLanguage, en: string, th: string) =>
    language === "th" ? th : en;

interface DataTablePaginationProps<TData> {
    table: Table<TData>;
    showPageSizeOptions?: boolean;
}

export function DataTablePagination<TData>({
    table,
    showPageSizeOptions = true,
}: DataTablePaginationProps<TData>) {
    const language = useLanguageStore((state) => state.language);

    return (
        <div className="flex items-center justify-between px-2">
            <div className="flex-1 text-sm text-muted-foreground">
                {table.getFilteredSelectedRowModel().rows.length}{" "}
                {tr(language, "of", "จาก")}{" "}
                {table.getFilteredRowModel().rows.length}{" "}
                {tr(language, "row(s) selected.", "แถวที่เลือก")}
            </div>
            <div className="flex items-center space-x-6 lg:space-x-8">
                {showPageSizeOptions && (
                    <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium">{tr(language, "Rows per page", "จำนวนแถวต่อหน้า")}</p>
                        <Select
                            value={`${table.getState().pagination.pageSize}`}
                            onValueChange={(value) => {
                                table.setPageSize(Number(value));
                            }}
                        >
                            <SelectTrigger className="h-8 w-[70px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent side="top">
                                {[10, 20, 30, 50, 100].map((pageSize) => (
                                    <SelectItem key={pageSize} value={`${pageSize}`}>
                                        {pageSize}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="flex w-[100px] items-center justify-center text-sm font-medium">
                    {tr(language, "Page", "หน้า")} {table.getState().pagination.pageIndex + 1}{" "}
                    {tr(language, "of", "จาก")}{" "}
                    {table.getPageCount()}
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <span className="sr-only">{tr(language, "Go to first page", "ไปหน้าแรก")}</span>
                        <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <span className="sr-only">{tr(language, "Go to previous page", "ไปหน้าก่อนหน้า")}</span>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        <span className="sr-only">{tr(language, "Go to next page", "ไปหน้าถัดไป")}</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                    >
                        <span className="sr-only">{tr(language, "Go to last page", "ไปหน้าสุดท้าย")}</span>
                        <ChevronsRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
