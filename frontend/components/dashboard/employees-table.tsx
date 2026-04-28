"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  UserGroupIcon,
  Search01Icon,
  FilterIcon,
  FileImportIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { useDashboardStore } from "@/store/dashboard-store";
import { useLanguageStore } from "@/store/language-store";
import { APP_LOCALE_MAP, type AppLanguage } from "@/store/language-config";
import { employees, type Employee } from "@/mock-data/employees";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [8, 15, 25, 50];
const tr = (language: AppLanguage, en: string, th: string) =>
  language === "th" ? th : en;
const localeOf = (language: AppLanguage) => APP_LOCALE_MAP[language] ?? "en-US";

const statusColors: Record<
  Employee["status"],
  { bg: string; text: string; border: string }
> = {
  Active: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800",
  },
  "On Leave": {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
  },
  Probation: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800",
  },
  Inactive: {
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-200 dark:border-red-800",
  },
};

export function EmployeesTable() {
  const language = useLanguageStore((state) => state.language);
  const searchQuery = useDashboardStore((state) => state.searchQuery);
  const departmentFilter = useDashboardStore((state) => state.departmentFilter);
  const statusFilter = useDashboardStore((state) => state.statusFilter);
  const setSearchQuery = useDashboardStore((state) => state.setSearchQuery);
  const setDepartmentFilter = useDashboardStore(
    (state) => state.setDepartmentFilter
  );
  const setStatusFilter = useDashboardStore((state) => state.setStatusFilter);
  const clearFilters = useDashboardStore((state) => state.clearFilters);

  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(8);
  const [selectedRows, setSelectedRows] = React.useState<Set<string>>(
    new Set()
  );

  const hasActiveFilters = departmentFilter !== "all" || statusFilter !== "all";

  const getDepartmentLabel = React.useCallback(
    (department: Employee["department"] | "all") => {
      if (department === "all") {
        return tr(language, "All Departments", "ทุกแผนก");
      }
      return department;
    },
    [language]
  );

  const getStatusLabel = React.useCallback(
    (status: Employee["status"] | "all") => {
      switch (status) {
        case "all":
          return tr(language, "All Statuses", "ทุกสถานะ");
        case "Active":
          return tr(language, "Active", "ใช้งานอยู่");
        case "On Leave":
          return tr(language, "On Leave", "ลางาน");
        case "Probation":
          return tr(language, "Probation", "ทดลองงาน");
        case "Inactive":
          return tr(language, "Inactive", "ไม่ใช้งาน");
        default:
          return status;
      }
    },
    [language]
  );

  const formatJoinedDate = React.useCallback(
    (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleDateString(localeOf(language), {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    },
    [language]
  );

  const filteredEmployees = React.useMemo(() => {
    return employees.filter((emp) => {
      const matchesSearch =
        emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.userId.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesDepartment =
        departmentFilter === "all" || emp.department === departmentFilter;

      const matchesStatus =
        statusFilter === "all" || emp.status === statusFilter;

      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }, [searchQuery, departmentFilter, statusFilter]);

  const totalPages = Math.ceil(filteredEmployees.length / pageSize);

  const paginatedEmployees = React.useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredEmployees.slice(startIndex, startIndex + pageSize);
  }, [filteredEmployees, currentPage, pageSize]);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, departmentFilter, statusFilter, pageSize]);

  const toggleSelectAll = () => {
    if (selectedRows.size === paginatedEmployees.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(paginatedEmployees.map((e) => e.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    const newSet = new Set(selectedRows);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedRows(newSet);
  };

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={UserGroupIcon}
            className="size-5 text-muted-foreground"
          />
          <span className="font-medium text-muted-foreground">
            {tr(language, "Employee list", "รายชื่อพนักงาน")}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <HugeiconsIcon
              icon={Search01Icon}
              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            />
            <Input
              placeholder={tr(language, "Search employees...", "ค้นหาพนักงาน...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-full sm:w-[220px] h-9"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center gap-2 h-9 px-3 rounded-md border text-sm font-medium",
                "border-border hover:bg-background bg-muted shadow-xs",
              )}
            >
              <HugeiconsIcon icon={FilterIcon} className="size-4" />
              {tr(language, "Filter", "ตัวกรอง")}
              {hasActiveFilters && (
                <span className="size-1.5 rounded-full bg-primary" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {tr(language, "Department", "แผนก")}
                </p>
                {["all", "IT", "HR", "Finance", "Marketing", "Sales"].map(
                  (dept) => (
                    <DropdownMenuCheckboxItem
                      key={dept}
                      checked={departmentFilter === dept}
                      onCheckedChange={() => setDepartmentFilter(dept)}
                    >
                      {getDepartmentLabel(dept as Employee["department"] | "all")}
                    </DropdownMenuCheckboxItem>
                  )
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <p className="text-muted-foreground px-2 py-1.5 text-sm font-medium">
                  {tr(language, "Status", "สถานะ")}
                </p>
                {["all", "Active", "On Leave", "Probation", "Inactive"].map(
                  (status) => (
                    <DropdownMenuCheckboxItem
                      key={status}
                      checked={statusFilter === status}
                      onCheckedChange={() => setStatusFilter(status)}
                    >
                      {getStatusLabel(status as Employee["status"] | "all")}
                    </DropdownMenuCheckboxItem>
                  )
                )}
              </DropdownMenuGroup>
              {hasActiveFilters && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={clearFilters}
                    className="text-destructive"
                  >
                    {tr(language, "Clear all filters", "ล้างตัวกรองทั้งหมด")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden sm:block w-px h-6 bg-border" />

          <Button variant="outline" className="gap-2">
            <HugeiconsIcon icon={FileImportIcon} className="size-4" />
            {tr(language, "Import", "นำเข้า")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={
                    selectedRows.size === paginatedEmployees.length &&
                    paginatedEmployees.length > 0
                  }
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead className="min-w-[100px] text-muted-foreground font-medium">
                {tr(language, "User ID", "รหัสผู้ใช้")}
              </TableHead>
              <TableHead className="min-w-[150px] text-muted-foreground font-medium">
                {tr(language, "Name", "ชื่อ")}
              </TableHead>
              <TableHead className="hidden md:table-cell min-w-[200px] text-muted-foreground font-medium">
                {tr(language, "Email Address", "อีเมล")}
              </TableHead>
              <TableHead className="hidden lg:table-cell min-w-[100px] text-muted-foreground font-medium">
                {tr(language, "Department", "แผนก")}
              </TableHead>
              <TableHead className="hidden lg:table-cell min-w-[140px] text-muted-foreground font-medium">
                {tr(language, "Job Title", "ตำแหน่งงาน")}
              </TableHead>
              <TableHead className="hidden sm:table-cell min-w-[120px] text-muted-foreground font-medium">
                {tr(language, "Joined Date", "วันที่เข้าร่วม")}
              </TableHead>
              <TableHead className="min-w-[100px] text-muted-foreground font-medium">
                {tr(language, "Status", "สถานะ")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedEmployees.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-24 text-center text-muted-foreground"
                >
                  {tr(
                    language,
                    "No employees found matching your filters.",
                    "ไม่พบพนักงานที่ตรงกับตัวกรองของคุณ"
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedEmployees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedRows.has(employee.id)}
                      onCheckedChange={() => toggleSelectRow(employee.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-muted-foreground">
                    {employee.userId}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-6">
                        {employee.avatar ? (
                          <AvatarImage src={employee.avatar} />
                        ) : null}
                        <AvatarFallback
                          className="text-xs font-semibold"
                          seed={`${employee.id}|${employee.name}|${employee.email}`}
                        >
                          {employee.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{employee.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {employee.email}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="px-2 py-0.5 rounded-md bg-muted text-sm font-medium text-muted-foreground">
                      {employee.department}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="px-2 py-0.5 rounded-md bg-muted text-sm font-medium text-muted-foreground">
                      {employee.jobTitle}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {formatJoinedDate(employee.joinedDate)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-sm font-medium",
                        statusColors[employee.status].bg,
                        statusColors[employee.status].text,
                        statusColors[employee.status].border
                      )}
                    >
                      {getStatusLabel(employee.status)}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-5 py-4 border-t">
        <div className="flex items-center gap-6">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            aria-label={tr(language, "Previous page", "หน้าก่อนหน้า")}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }

              if (i === 3 && totalPages > 5 && currentPage < totalPages - 2) {
                return (
                  <span key="ellipsis" className="px-3 py-1 text-sm">
                    ...
                  </span>
                );
              }

              if (i === 4 && totalPages > 5) {
                pageNum = totalPages;
              }

              return (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setCurrentPage(pageNum)}
                  className={cn(currentPage === pageNum && "bg-muted")}
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            aria-label={tr(language, "Next page", "หน้าถัดไป")}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {tr(language, "Showing", "แสดง")} {(currentPage - 1) * pageSize + 1}{" "}
            {tr(language, "to", "ถึง")}{" "}
            {Math.min(currentPage * pageSize, filteredEmployees.length)}{" "}
            {tr(language, "of", "จาก")} {filteredEmployees.length}{" "}
            {tr(language, "entries", "รายการ")}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 h-8 px-2.5 rounded-md border border-border bg-background hover:bg-muted shadow-xs text-sm font-medium">
              {tr(language, "Show", "แสดง")} {pageSize}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="size-3 rotate-90"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => setPageSize(size)}
                  className={cn(pageSize === size && "bg-muted")}
                >
                  {tr(language, "Show", "แสดง")} {size}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
