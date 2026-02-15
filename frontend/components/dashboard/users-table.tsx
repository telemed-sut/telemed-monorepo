"use client";

import { useEffect, useState, useMemo } from "react";
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import {
    fetchUsers,
    deleteUser,
    verifyUser,
    createUser,
    updateUser,
    User
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";
import {
    Search,
    Filter,
    MoreHorizontal,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    Loader2,
    AlertTriangle,
    UserCog,
    Shield,
    ShieldAlert,
    Mail,
    MoreVertical,
    Plus,
    Trash2,
    Pencil,
    Copy,
    ExternalLink,
    CheckCircle2,
    XCircle,
    X,
    BadgeCheck,
    Clock,
    Link2,
    FileDown,
    ArrowUpDown,
} from "lucide-react";


import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import { DataTableViewOptions } from "./data-table-view-options";



// --- Constants & Helpers ---

const ROLE_OPTIONS = [
    { value: "admin", label: "Administrator" },
    { value: "doctor", label: "Doctor" },
    { value: "nurse", label: "Nurse" },
    { value: "pharmacist", label: "Pharmacist" },
    { value: "medical_technologist", label: "Medical Technologist" },
    { value: "psychologist", label: "Psychologist" },
    { value: "staff", label: "Staff" },
];

const ROLE_LABEL_MAP: Record<string, string> = ROLE_OPTIONS.reduce(
    (acc, curr) => ({ ...acc, [curr.value]: curr.label }),
    {}
);

const isClinicalRole = (role: string) => {
    return [
        "doctor",
        "nurse",
        "pharmacist",
        "medical_technologist",
        "psychologist",
    ].includes(role);
};

const isLicenseExpired = (expiryDate?: string) => {
    if (!expiryDate) return false;
    return new Date(expiryDate) < new Date();
};

const isLicenseExpiringSoon = (expiryDate?: string) => {
    if (!expiryDate) return false;
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 && diffDays <= 30;
};

// --- Component ---

export function UsersTable() {
    const { role: currentUserRole, token, userId: currentUserId } = useAuthStore();

    // State for data
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    // Table State
    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: 10,
    });
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = useLocalStorage<VisibilityState>("users-table-visibility", {});
    const [rowSelection, setRowSelection] = useState({});

    // CRUD & Dialog State
    const [isSheetOpen, setSheetOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [isInviteSheetOpen, setInviteSheetOpen] = useState(false);
    const [isInviteSubmitting, setIsInviteSubmitting] = useState(false);
    const [inviteConfirmOpen, setInviteConfirmOpen] = useState(false);
    const [generatedInviteUrl, setGeneratedInviteUrl] = useState("");

    const [deleteUserOpen, setDeleteUserOpen] = useState(false);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);

    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

    // Form Data State
    interface UserFormData extends Partial<User> {
        password?: string;
    }

    const [formData, setFormData] = useState<UserFormData>({
        email: "",
        first_name: "",
        last_name: "",
        password: "",
        role: "staff",
        is_active: true,
        specialty: "",
        department: "",
        license_no: "",
        license_expiry: "",
        verification_status: "unverified",
    });

    const [inviteFormData, setInviteFormData] = useState({
        email: "",
        role: "staff",
    });

    // Load Data
    const loadUsers = async () => {
        if (!token) return;
        setLoading(true);
        try {
            const sortField =
                sorting.length > 0
                    ? sorting[0].id === "name"
                        ? "first_name"
                        : sorting[0].id
                    : "created_at";
            const res = await fetchUsers({
                page: pagination.pageIndex + 1,
                limit: pagination.pageSize,
                sort: sortField,
                order: sorting.length > 0 && sorting[0].desc ? "desc" : "asc",
                // search: debouncedSearch // Assuming we add search later or use local filtering for now if backend doesn't support 'q' yet on users
            }, token);

            // Ensure type compatibility by handling nulls if necessary, though User from API should match User in state
            setUsers(res.items || []);
            setTotal(res.total || 0);
        } catch (error) {
            console.error(error);
            toast.error("Error", {
                description: "Failed to load users.",
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, [pagination.pageIndex, pagination.pageSize, sorting]);


    // --- Handlers from Original ---

    const handleOpenEdit = (user: User) => {
        setEditingUser(user);
        setFormData({ ...user, password: "" }); // Clear password for security
        setSheetOpen(true);
    };

    const handleCreateUser = () => {
        setEditingUser(null);
        setFormData({
            email: "",
            first_name: "",
            last_name: "",
            role: "staff",
            is_active: true,
            specialty: "",
            department: "",
            license_no: "",
            license_expiry: "",
            verification_status: "unverified",
            password: "",
        });
        setSheetOpen(true);
    };

    const handleDelete = (user: User) => {
        setUserToDelete(user);
        setDeleteUserOpen(true);
    };

    const confirmDelete = async () => {
        if (!userToDelete) return;
        try {
            const res = await fetch(`/api/users/${userToDelete.id}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("Failed to delete user");
            toast.success("Success", {
                description: "User deleted successfully",
            });
            loadUsers();
            setDeleteUserOpen(false);
        } catch (error) {
            toast.error("Error", {
                description: "Could not delete user",
            });
        }
    };

    const handleVerifyUser = async (user: User) => {
        try {
            const res = await fetch(`/api/users/${user.id}/verify`, {
                method: 'POST'
            });
            if (!res.ok) throw new Error("Failed to verify user");
            toast.success("Verified", { description: "User has been verified." });
            loadUsers();
        } catch (err) {
            toast.error("Error", { description: "Verification failed." });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
            const method = editingUser ? "PUT" : "POST";
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });
            if (!res.ok) throw new Error("Operation failed");
            toast.success("Success", { description: editingUser ? "User updated" : "User created" });
            setSheetOpen(false);
            loadUsers();
        } catch (error) {
            toast.error("Error", { description: "Failed to save user" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreateInviteRequest = (e: React.FormEvent) => {
        e.preventDefault();
        setInviteConfirmOpen(true);
    };

    const handleConfirmCreateInvite = async () => {
        setInviteConfirmOpen(false);
        setIsInviteSubmitting(true);
        try {
            const res = await fetch("/api/invites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(inviteFormData),
            });
            if (!res.ok) throw new Error("Failed to create invite");
            const data = await res.json();
            setGeneratedInviteUrl(data.invite_url); // Assuming API returns this
            toast.success("Success", { description: "Invite link generated" });
        } catch (error) {
            toast.error("Error", { description: "Could not generate invite" });
        } finally {
            setIsInviteSubmitting(false);
        }
    };

    const handleCopyInviteUrl = () => {
        navigator.clipboard.writeText(generatedInviteUrl);
        toast.success("Copied", { description: "Invite URL copied to clipboard" });
    };

    // Bulk Delete
    const handleBulkDelete = async (ids: string[]) => {
        try {
            setIsBulkDeleting(true);
            // Assuming API supports bulk delete via POST /api/users/batch-delete or similar. 
            // If not detailed in original code (likely not implemented), we'll implement loop or new endpoint.
            // Since original code had empty implementation for bulk delete, we'll try sequential delete or placeholder.
            // For safety, let's just log and toast for now as 'Implemented in API'.
            // Wait, the plan was to implement it.
            // We'll iterate for now.
            await Promise.all(ids.map(id => fetch(`/api/users/${id}`, { method: "DELETE" })));

            toast.success("Success", { description: "Selected users deleted." });
            setRowSelection({});
            loadUsers();
        } catch (error) {
            toast.error("Error", { description: "Bulk delete failed." });
        } finally {
            setIsBulkDeleting(false);
            setBulkDeleteOpen(false);
        }
    };

    // --- Columns Definition ---

    const columns: ColumnDef<User>[] = useMemo(() => [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={
                        (table.getIsAllPageRowsSelected() ||
                            (table.getIsSomePageRowsSelected() && "indeterminate")) as any
                    }
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all"
                    className="translate-y-[2px]"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="translate-y-[2px]"
                />
            ),
            enableSorting: false,
            enableHiding: false,
        },
        {
            accessorKey: "name", // Combination of first/last
            header: ({ column }) => (
                <div className="flex items-center space-x-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-accent"
                        onClick={() => {
                            // Toggle sorting manually to map to backend expected format if needed
                            // Or let TanStack handle state and we listen in useEffect
                            column.toggleSorting(column.getIsSorted() === "asc");
                        }}
                    >
                        <span>Name</span>
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            ),
            cell: ({ row }) => {
                const user = row.original;
                const fallback = user.first_name ? user.first_name[0] : user.email[0].toUpperCase();
                return (
                    <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                            <AvatarImage src={user.avatar_url || undefined} />
                            <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                                {fallback}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                            <span className="font-medium truncate text-sm">
                                {user.first_name} {user.last_name || ""}
                            </span>
                            {isClinicalRole(user.role) && user.specialty && (
                                <span className="text-xs text-muted-foreground">{user.specialty}</span>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: "email",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Email
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Mail className="h-3.5 w-3.5" />
                    {row.original.email}
                </div>
            ),
        },
        {
            accessorKey: "role",
            header: "Role",
            cell: ({ row }) => {
                const role = row.original.role;
                return (
                    <Badge
                        variant={role === "admin" ? "default" : "secondary"}
                        className={cn(
                            "capitalize",
                            role === "admin" && "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20",
                            role === "doctor" && "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
                            role === "nurse" && "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20",
                            role === "staff" && "bg-slate-500/10 text-slate-500 hover:bg-slate-500/20"
                        )}
                    >
                        {ROLE_LABEL_MAP[role] || role}
                    </Badge>
                );
            },
        },
        {
            accessorKey: "status",
            header: "Status",
            cell: ({ row }) => {
                const user = row.original;
                if (!isClinicalRole(user.role)) return <span className="text-muted-foreground text-xs">N/A</span>;

                const status = user.verification_status || "unverified";
                return (
                    <Badge
                        variant="outline"
                        className={cn(
                            "flex w-fit items-center gap-1",
                            status === "verified" && "border-green-500/20 text-green-500 bg-green-500/10",
                            status === "pending" && "border-amber-500/20 text-amber-500 bg-amber-500/10",
                            status === "unverified" && "border-red-500/20 text-red-500 bg-red-500/10"
                        )}
                    >
                        {status === "verified" && <BadgeCheck className="h-3 w-3" />}
                        {status === "pending" && <Clock className="h-3 w-3" />}
                        {status === "unverified" && <XCircle className="h-3 w-3" />}
                        <span className="capitalize">{status}</span>
                    </Badge>
                );
            }
        },
        {
            accessorKey: "created_at",
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3 h-8"
                    onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
                >
                    Created
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const date = row.original.created_at;
                if (!date) return "-";
                return <div className="text-sm text-muted-foreground">{new Date(date).toLocaleDateString()}</div>
            }
        },
        {
            id: "actions",
            cell: ({ row }) => {
                if (currentUserRole !== "admin") return null;
                const user = row.original;

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => handleOpenEdit(user)}>
                                    <Pencil className="mr-2 h-4 w-4" /> Edit
                                </DropdownMenuItem>
                                {isClinicalRole(user.role) && user.verification_status !== "verified" && (
                                    <DropdownMenuItem onClick={() => handleVerifyUser(user)}>
                                        <BadgeCheck className="mr-2 h-4 w-4 text-green-500" /> Verify
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={() => handleDelete(user)}
                                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                >
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ], [currentUserRole, handleOpenEdit, handleDelete, handleVerifyUser]);


    const table = useReactTable({
        data: users,
        columns,
        state: {
            sorting,
            columnVisibility,
            rowSelection,
            columnFilters,
            pagination,
        },
        enableRowSelection: true,
        pageCount: Math.ceil(total / pagination.pageSize),
        onRowSelectionChange: setRowSelection,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        onPaginationChange: setPagination,
        getRowId: (row) => row.id,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        manualPagination: true,
        manualSorting: true,
        // manualFiltering: true, // If we implement backend search
    });

    // --- Pagination helpers ---
    const totalPages = table.getPageCount();
    const currentPage = pagination.pageIndex + 1;
    const goToPage = (page: number) => {
        const clamped = Math.max(1, Math.min(page, totalPages));
        table.setPageIndex(clamped - 1);
    };

    const selectedRows = table.getFilteredSelectedRowModel().rows;
    const selectedIds = selectedRows.map((row) => (row.original as any).id);

    // --- Role filter state ---
    const [roleFilter, setRoleFilter] = useState("all");
    const [statusFilterLocal, setStatusFilterLocal] = useState("all");
    const [searchLocal, setSearchLocal] = useState("");

    const hasActiveFilters = roleFilter !== "all" || statusFilterLocal !== "all";
    const clearLocalFilters = () => { setRoleFilter("all"); setStatusFilterLocal("all"); };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border bg-card">
                {/* ── Header Bar ── */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:px-6 sm:py-3.5">
                    <div className="flex items-center gap-2 sm:gap-2.5 flex-1">
                        <Button variant="outline" size="icon" className="size-7 sm:size-8 shrink-0">
                            <UserCog className="size-4 sm:size-[18px] text-muted-foreground" />
                        </Button>
                        <span className="text-sm sm:text-base font-medium">User Management</span>
                        <Badge variant="secondary" className="ml-1 text-[10px] sm:text-xs">
                            {total}
                        </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 sm:flex-none">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 sm:size-5 text-muted-foreground" />
                            <Input
                                placeholder="Search users..."
                                value={searchLocal}
                                onChange={(e) => setSearchLocal(e.target.value)}
                                className="pl-9 sm:pl-10 w-full sm:w-[160px] lg:w-[200px] h-8 sm:h-9 text-sm"
                            />
                        </div>

                        {/* Filter Dropdown */}
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground px-3 text-xs font-medium h-8 sm:h-9 gap-1.5 sm:gap-2 focus-visible:outline-none ${hasActiveFilters ? "border-primary" : ""}`}
                            >
                                <Filter className="size-3.5 sm:size-4" />
                                <span className="hidden sm:inline">Filter</span>
                                {hasActiveFilters && (
                                    <span className="size-1.5 sm:size-2 rounded-full bg-primary" />
                                )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[220px]">
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>Filter by Role</DropdownMenuLabel>
                                    <DropdownMenuCheckboxItem
                                        checked={roleFilter === "all"}
                                        onCheckedChange={() => setRoleFilter("all")}
                                    >
                                        All Roles
                                    </DropdownMenuCheckboxItem>
                                    {ROLE_OPTIONS.map((r) => (
                                        <DropdownMenuCheckboxItem
                                            key={r.value}
                                            checked={roleFilter === r.value}
                                            onCheckedChange={() => setRoleFilter(r.value)}
                                        >
                                            {r.label}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                                    <DropdownMenuCheckboxItem
                                        checked={statusFilterLocal === "all"}
                                        onCheckedChange={() => setStatusFilterLocal("all")}
                                    >
                                        All Statuses
                                    </DropdownMenuCheckboxItem>
                                    {["verified", "pending", "unverified"].map((s) => (
                                        <DropdownMenuCheckboxItem
                                            key={s}
                                            checked={statusFilterLocal === s}
                                            onCheckedChange={() => setStatusFilterLocal(s)}
                                        >
                                            <span className="capitalize">{s}</span>
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                                {hasActiveFilters && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={clearLocalFilters} className="text-destructive">
                                            <X className="size-4 mr-2" />
                                            Clear all filters
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Bulk delete */}
                        {selectedIds.length > 0 && (
                            <Button
                                variant="destructive"
                                size="sm"
                                className="h-8 sm:h-9 gap-1.5"
                                onClick={() => {
                                    setSelectedUserIds(selectedIds);
                                    setBulkDeleteOpen(true);
                                }}
                            >
                                <Trash2 className="size-3.5 sm:size-4" />
                                Delete ({selectedIds.length})
                            </Button>
                        )}

                        <div className="hidden sm:block w-px h-[22px] bg-border" />

                        {/* View options */}
                        <DataTableViewOptions table={table} />

                        {currentUserRole === "admin" && (
                            <>
                                <Button variant="outline" size="sm" className="h-8 sm:h-9 gap-1.5 sm:gap-2" onClick={() => setInviteSheetOpen(true)}>
                                    <Link2 className="size-3.5 sm:size-4" />
                                    <span className="hidden sm:inline">Invite</span>
                                </Button>
                                <Button size="sm" className="h-8 sm:h-9 gap-1.5 sm:gap-2" onClick={handleCreateUser}>
                                    <Plus className="size-3.5 sm:size-4" />
                                    <span className="hidden sm:inline">New User</span>
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Active filter badges ── */}
                {hasActiveFilters && (
                    <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 pb-3">
                        <span className="text-[10px] sm:text-xs text-muted-foreground">Filters:</span>
                        {roleFilter !== "all" && (
                            <Badge
                                variant="secondary"
                                className="gap-1 cursor-pointer text-[10px] sm:text-xs h-5 sm:h-6"
                                onClick={() => setRoleFilter("all")}
                            >
                                {ROLE_LABEL_MAP[roleFilter] || roleFilter}
                                <X className="size-2.5 sm:size-3" />
                            </Badge>
                        )}
                        {statusFilterLocal !== "all" && (
                            <Badge
                                variant="secondary"
                                className="gap-1 cursor-pointer text-[10px] sm:text-xs h-5 sm:h-6"
                                onClick={() => setStatusFilterLocal("all")}
                            >
                                <span className="capitalize">{statusFilterLocal}</span>
                                <X className="size-2.5 sm:size-3" />
                            </Badge>
                        )}
                    </div>
                )}

                {/* ── Table ── */}
                <div className="px-3 sm:px-6 pb-3 sm:pb-4 relative">
                    <div className={cn("max-h-[500px] overflow-x-auto overflow-y-auto rounded-md border border-white/10 lg:max-h-[620px] transition-opacity duration-200", loading && "opacity-50 pointer-events-none")}>
                        <Table>
                            <TableHeader className="sticky top-0 z-20 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60">
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <TableRow key={headerGroup.id} className="bg-muted/50 hover:bg-muted/50">
                                        {headerGroup.headers.map((header) => (
                                            <TableHead key={header.id} className="font-medium text-muted-foreground text-xs sm:text-sm">
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(
                                                        header.column.columnDef.header,
                                                        header.getContext()
                                                    )}
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableHeader>
                            <TableBody>
                                {table.getRowModel().rows?.length ? (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow
                                            key={row.id}
                                            data-state={row.getIsSelected() && "selected"}
                                            className="group hover:bg-muted/5"
                                        >
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell key={cell.id} className="py-2.5 text-xs sm:text-sm">
                                                    {flexRender(
                                                        cell.column.columnDef.cell,
                                                        cell.getContext()
                                                    )}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell
                                            colSpan={columns.length}
                                            className="h-24 text-center text-muted-foreground text-sm"
                                        >
                                            {loading ? (
                                                <div className="flex justify-center items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                                                </div>
                                            ) : "No users found."}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                {/* ── Pagination (numbered pages like square-ui) ── */}
                <div className="flex flex-col gap-3 border-t bg-background/60 px-3 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                        <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium">
                            {selectedIds.length > 0
                                ? `${selectedIds.length} selected`
                                : `${pagination.pageIndex * pagination.pageSize + 1}-${Math.min((pagination.pageIndex + 1) * pagination.pageSize, total)} of ${total}`}
                        </span>
                        <Select
                            value={pagination.pageSize.toString()}
                            onValueChange={(value) => table.setPageSize(Number(value))}
                        >
                            <SelectTrigger variant="glass" className="h-8 w-[96px] rounded-full text-xs shadow-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {[10, 20, 30, 50].map((size) => (
                                    <SelectItem key={size} value={size.toString()}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button variant="outline" size="icon" className="size-8 rounded-full border-white/20 bg-white/5 shadow-sm hover:bg-white/10" onClick={() => goToPage(1)} disabled={currentPage === 1 || loading}>
                            <ChevronsLeft className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="size-8 rounded-full border-white/20 bg-white/5 shadow-sm hover:bg-white/10" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1 || loading}>
                            <ChevronLeft className="size-4" />
                        </Button>
                        <div className="flex items-center gap-1 mx-1">
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
                                return (
                                    <Button
                                        key={pageNum}
                                        variant={currentPage === pageNum ? "default" : "outline"}
                                        size="icon"
                                        disabled={loading}
                                        className={cn(
                                            "size-8 rounded-full text-xs shadow-sm",
                                            currentPage === pageNum
                                                ? "bg-primary text-primary-foreground"
                                                : "border-white/20 bg-white/5 hover:bg-white/10"
                                        )}
                                        onClick={() => goToPage(pageNum)}
                                    >
                                        {loading && currentPage === pageNum ? <Loader2 className="h-3 w-3 animate-spin" /> : pageNum}
                                    </Button>
                                );
                            })}
                        </div>
                        <Button variant="outline" size="icon" className="size-8 rounded-full border-white/20 bg-white/5 shadow-sm hover:bg-white/10" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages || totalPages === 0 || loading}>
                            <ChevronRight className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon" className="size-8 rounded-full border-white/20 bg-white/5 shadow-sm hover:bg-white/10" onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages || totalPages === 0 || loading}>
                            <ChevronsRight className="size-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* --- Dialogs (Copied & Adapted) --- */}

            {/* Create/Edit Sheet */}
            <Sheet open={isSheetOpen} onOpenChange={setSheetOpen}>
                <SheetContent
                    side="center"
                    className="w-[min(94vw,680px)] max-h-[88vh] p-0 overflow-hidden rounded-2xl border border-border/60 bg-background/95"
                >
                    <SheetHeader className="px-6 pt-6 pb-3 border-b bg-muted/20">
                        <SheetTitle className="flex items-center gap-2">
                            {editingUser ? (
                                <UserCog className="w-5 h-5 text-primary" />
                            ) : (
                                <Plus className="w-5 h-5 text-primary" />
                            )}
                            {editingUser ? "Edit User" : "Create New User"}
                        </SheetTitle>
                        <SheetDescription>
                            {editingUser
                                ? "Make changes to the user's account details."
                                : "Add a new user to the system."}
                        </SheetDescription>
                    </SheetHeader>

                    <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[calc(88vh-120px)]">
                        <div className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="first_name">First Name</Label>
                                    <Input
                                        id="first_name"
                                        placeholder="John"
                                        value={formData.first_name || ""}
                                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="last_name">Last Name</Label>
                                    <Input
                                        id="last_name"
                                        placeholder="Doe"
                                        value={formData.last_name || ""}
                                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                                    />
                                </div>
                            </div>
                            {/* ... (Other form fields - mostly identical to logic above but reconstructed) ... */}
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address <span className="text-red-500">*</span></Label>
                                <Input
                                    id="email" type="email" placeholder="john.doe@example.com"
                                    required value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">
                                    {editingUser ? "Password (leave blank to keep)" : "Password"}
                                    {!editingUser && <span className="text-red-500">*</span>}
                                </Label>
                                <Input
                                    id="password" type="password" placeholder="••••••••"
                                    required={!editingUser} minLength={6}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="role">Role</Label>
                                <Select
                                    value={formData.role}
                                    onValueChange={(val) => setFormData({ ...formData, role: val as any || "staff" })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ROLE_OPTIONS.map((r) => (
                                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {editingUser && (
                                <div className="space-y-2">
                                    <Label htmlFor="status">Account Status</Label>
                                    <Select
                                        value={formData.is_active ? "active" : "inactive"}
                                        onValueChange={(val) => setFormData({ ...formData, is_active: val === "active" })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="inactive">Inactive</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {isClinicalRole(formData.role || "") && (
                                <div className="space-y-4 rounded-lg border border-border/60 p-4 bg-muted/10">
                                    <p className="text-sm font-medium text-muted-foreground">Professional Information</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="specialty">Specialty</Label>
                                            <Input id="specialty" value={formData.specialty || ""} onChange={e => setFormData({ ...formData, specialty: e.target.value })} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="department">Department</Label>
                                            <Input id="department" value={formData.department || ""} onChange={e => setFormData({ ...formData, department: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="license_no">License No. <span className="text-red-500">*</span></Label>
                                            <Input id="license_no" required value={formData.license_no || ""} onChange={e => setFormData({ ...formData, license_no: e.target.value })} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="license_expiry">License Expiry</Label>
                                            <Input type="date" id="license_expiry" value={formData.license_expiry || ""} onChange={e => setFormData({ ...formData, license_expiry: e.target.value })} />
                                        </div>
                                    </div>
                                    {editingUser && (
                                        <div className="space-y-2">
                                            <Label htmlFor="verification_status">Verification Status</Label>
                                            <Select value={formData.verification_status || "unverified"} onValueChange={val => setFormData({ ...formData, verification_status: val as any })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="unverified">Unverified</SelectItem>
                                                    <SelectItem value="pending">Pending</SelectItem>
                                                    <SelectItem value="verified">Verified</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <SheetFooter className="px-0 pt-2 pb-0 sm:justify-end sm:flex-row">
                            <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {editingUser ? "Save Changes" : "Create User"}
                            </Button>
                        </SheetFooter>
                    </form>
                </SheetContent>
            </Sheet>

            {/* Invite Sheet */}
            <Sheet open={isInviteSheetOpen} onOpenChange={setInviteSheetOpen}>
                <SheetContent side="center" className="w-[min(94vw,620px)] max-h-[84vh] p-0 overflow-hidden rounded-2xl border border-border/60 bg-background/95">
                    <SheetHeader className="px-6 pt-6 pb-3 border-b bg-muted/20">
                        <SheetTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" /> Create Invite Link</SheetTitle>
                        <SheetDescription>Only admins can generate registration links for approved healthcare users.</SheetDescription>
                    </SheetHeader>
                    <form onSubmit={handleCreateInviteRequest} className="p-6 space-y-5 overflow-y-auto max-h-[calc(84vh-120px)]">
                        <div className="space-y-2">
                            <Label htmlFor="invite_email">Email <span className="text-red-500">*</span></Label>
                            <Input id="invite_email" type="email" required value={inviteFormData.email || ""} onChange={e => setInviteFormData({ ...inviteFormData, email: e.target.value })} placeholder="doctor@hospital.org" />
                        </div>
                        <div className="space-y-2">
                            <Label>Role</Label>
                            <Select value={inviteFormData.role} onValueChange={val => setInviteFormData({ ...inviteFormData, role: val ?? "" })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">Invite link expires in 24 hours (fixed by system policy).</div>
                        {generatedInviteUrl && (
                            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Invite Link</Label>
                                <Input value={generatedInviteUrl || ""} readOnly />
                                <Button type="button" variant="outline" className="w-full" onClick={handleCopyInviteUrl}><Copy className="mr-2 h-4 w-4" /> Copy Link</Button>
                            </div>
                        )}
                        <SheetFooter className="px-0 pt-2 pb-0 sm:justify-end sm:flex-row">
                            <Button type="button" variant="outline" onClick={() => setInviteSheetOpen(false)}>Close</Button>
                            <Button type="submit" disabled={isInviteSubmitting}>
                                {isInviteSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Generate
                            </Button>
                        </SheetFooter>
                    </form>
                </SheetContent>
            </Sheet>

            {/* Invite Confirmation */}
            <AlertDialog open={inviteConfirmOpen} onOpenChange={setInviteConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-500" /> Confirm Invite Creation</AlertDialogTitle>
                        <AlertDialogDescription>Please verify email and role.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmCreateInvite}>Confirm & Generate</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteUserOpen} onOpenChange={setDeleteUserOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-red-500"><Trash2 className="h-5 w-5" /> Delete User</AlertDialogTitle>
                        <AlertDialogDescription>Are you sure you want to delete {userToDelete?.first_name} {userToDelete?.last_name}? Action can be reversed by admin.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete User</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Bulk Delete */}
            <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-red-500"><Trash2 className="h-5 w-5" /> Bulk Delete Users</AlertDialogTitle>
                        <AlertDialogDescription>Are you sure you want to delete {selectedUserIds.length} user(s)?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleBulkDelete(selectedUserIds)} className="bg-red-600 hover:bg-red-700" disabled={isBulkDeleting}>
                            {isBulkDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
