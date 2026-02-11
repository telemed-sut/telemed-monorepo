"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
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
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    Loader2,
    MoreHorizontal,
    Plus,
    Search,
    UserCog,
    Mail,
    Shield,
    RefreshCw,
    Trash2,
    Pencil,
    ShieldAlert,
    CheckCircle2,
    XCircle,
    Users
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
import {
    fetchUsers,
    createUser,
    updateUser,
    deleteUser,
    User,
    UserCreate,
    UserUpdate
} from "@/lib/api";
import { useAuthStore } from "@/store/auth-store";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface UserFormState {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    role: string;
    is_active: boolean;
}

const initialFormState: UserFormState = {
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    role: "staff",
    is_active: true,
};

export function UsersTable() {
    const router = useRouter();
    const token = useAuthStore((state) => state.token);
    const role = useAuthStore((state) => state.role);
    const clearToken = useAuthStore((state) => state.clearToken);

    // Data State
    const [users, setUsers] = useState<User[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");

    // UI State
    const [isSheetOpen, setSheetOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [formData, setFormData] = useState<UserFormState>(initialFormState);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Delete Dialog
    const [deleteUserOpen, setDeleteUserOpen] = useState(false);
    const [userToDelete, setUserToDelete] = useState<User | null>(null);

    // Load Data
    const loadUsers = async () => {
        if (!token) return;

        try {
            setLoading(true);
            setError(null);

            const params: any = {
                page,
                limit,
                sort: "created_at",
                order: "desc"
            };

            if (search) params.q = search;
            if (roleFilter !== "all") params.role = roleFilter;

            const response = await fetchUsers(params, token);

            setUsers(response.items);
            setTotal(response.total);
        } catch (err: any) {
            console.error("Failed to load users:", err);
            if (err.status === 401 || err.message?.includes("401")) {
                clearToken();
                router.push("/login");
                return;
            }
            setError("Failed to load users. Please try again.");
            toast.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1);
            loadUsers();
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, roleFilter]);

    // Pagination change
    useEffect(() => {
        loadUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, limit]);

    // Handlers
    const handleOpenCreate = () => {
        setEditingUser(null);
        setFormData(initialFormState);
        setSheetOpen(true);
    };

    const handleOpenEdit = (user: User) => {
        setEditingUser(user);
        setFormData({
            email: user.email,
            password: "", // Don't show password
            first_name: user.first_name || "",
            last_name: user.last_name || "",
            role: user.role,
            is_active: user.is_active,
        });
        setSheetOpen(true);
    };

    const handleDelete = (user: User) => {
        setUserToDelete(user);
        setDeleteUserOpen(true);
    };

    const confirmDelete = async () => {
        if (!userToDelete || !token) return;

        try {
            await deleteUser(userToDelete.id, token);
            toast.success("User deleted successfully");
            setDeleteUserOpen(false);
            setUserToDelete(null);
            loadUsers(); // Refresh list
        } catch (err: any) {
            console.error("Delete error:", err);
            toast.error(err.message || "Failed to delete user");
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) return;

        try {
            setIsSubmitting(true);

            if (editingUser) {
                // Update
                const updateData: UserUpdate = {
                    email: formData.email,
                    first_name: formData.first_name,
                    last_name: formData.last_name,
                    role: formData.role,
                    is_active: formData.is_active,
                };

                // Only include password if changed
                if (formData.password) {
                    updateData.password = formData.password;
                }

                await updateUser(editingUser.id, updateData, token);
                toast.success("User updated successfully");
            } else {
                // Create
                const createData: UserCreate = {
                    email: formData.email,
                    password: formData.password,
                    first_name: formData.first_name,
                    last_name: formData.last_name,
                    role: formData.role,
                };

                await createUser(createData, token);
                toast.success("User created successfully");
            }

            setSheetOpen(false);
            loadUsers();
        } catch (err: any) {
            console.error("Submit error:", err);
            toast.error(err.message || "Operation failed");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Card className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
            <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <CardTitle className="text-xl font-semibold flex items-center gap-2">
                            <Users className="w-5 h-5 text-primary" />
                            User Management
                        </CardTitle>
                        <CardDescription>
                            Manage system users, roles, and permissions. Total: {total}
                        </CardDescription>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by email..."
                                className="pl-9 w-full sm:w-[250px] bg-background/50 border-white/10"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>

                        <Select value={roleFilter} onValueChange={(val) => setRoleFilter(val || "all")}>
                            <SelectTrigger className="w-full sm:w-[140px] bg-background/50 border-white/10">
                                <div className="flex items-center gap-2">
                                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                                    <SelectValue>
                                        {roleFilter === 'all' ? 'All Roles' :
                                            roleFilter === 'admin' ? 'Admin' :
                                                roleFilter === 'staff' ? 'Staff' : 'Role'}
                                    </SelectValue>
                                </div>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Roles</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="staff">Staff</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button
                            variant="outline"
                            size="icon"
                            className="bg-background/50 border-white/10"
                            onClick={loadUsers}
                            disabled={loading}
                        >
                            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                        </Button>

                        {role === 'admin' && (
                            <Button onClick={handleOpenCreate} className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20">
                                <Plus className="mr-2 h-4 w-4" />
                                Add User
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border border-white/10 overflow-hidden">
                    <Table>
                        <TableHeader className="bg-white/5">
                            <TableRow className="hover:bg-transparent border-white/10">
                                <TableHead>Name</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created At</TableHead>
                                {role === 'admin' && <TableHead className="text-right">Actions</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && users.length === 0 ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i} className="border-white/10">
                                        <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                                        {role === 'admin' && <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>}
                                    </TableRow>
                                ))
                            ) : users.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={role === 'admin' ? 6 : 5} className="h-24 text-center text-muted-foreground">
                                        No users found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                <AnimatePresence mode="popLayout">
                                    {users.map((user) => (
                                        <motion.tr
                                            key={user.id}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -10 }}
                                            transition={{ duration: 0.2 }}
                                            className="group border-b border-white/5 hover:bg-white/5 transition-colors"
                                        >
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs uppercase">
                                                        {user.first_name ? user.first_name[0] : user.email[0]}
                                                    </div>
                                                    <span>{user.first_name} {user.last_name}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2 text-muted-foreground">
                                                    <Mail className="w-3.5 h-3.5" />
                                                    {user.email}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className={cn("capitalize", user.role === 'admin' && "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20")}>
                                                    {user.role}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {user.is_active ? (
                                                    <Badge variant="outline" className="border-green-500/20 text-green-500 bg-green-500/10 flex items-center gap-1 w-fit">
                                                        <CheckCircle2 className="w-3 h-3" /> Active
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="border-red-500/20 text-red-500 bg-red-500/10 flex items-center gap-1 w-fit">
                                                        <XCircle className="w-3 h-3" /> Inactive
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                                            </TableCell>
                                            {role === 'admin' && (
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8 text-muted-foreground hover:text-foreground")}>
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuGroup>
                                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                                <DropdownMenuItem onClick={() => handleOpenEdit(user)}>
                                                                    <Pencil className="mr-2 h-4 w-4" /> Edit User
                                                                </DropdownMenuItem>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    onClick={() => handleDelete(user)}
                                                                    className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/20"
                                                                >
                                                                    <Trash2 className="mr-2 h-4 w-4" /> Delete User
                                                                </DropdownMenuItem>
                                                            </DropdownMenuGroup>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            )}
                                        </motion.tr>
                                    ))}
                                </AnimatePresence>
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between space-x-2 py-4">
                    <div className="flex-1 text-sm text-muted-foreground">
                        Page {page} of {Math.ceil(total / limit)}
                    </div>
                    <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium">Rows per page</p>
                        <Select
                            value={limit.toString()}
                            onValueChange={(val) => {
                                setLimit(Number(val));
                                setPage(1);
                            }}
                        >
                            <SelectTrigger className="h-8 w-[70px]">
                                <SelectValue>{limit}</SelectValue>
                            </SelectTrigger>
                            <SelectContent side="top">
                                {PAGE_SIZE_OPTIONS.map((pageSize) => (
                                    <SelectItem key={pageSize} value={`${pageSize}`}>
                                        {pageSize}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1 || loading}
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => p + 1)}
                                disabled={page * limit >= total || loading}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                </div>
            </CardContent>

            {/* Create/Edit Sheet */}
            <Sheet open={isSheetOpen} onOpenChange={setSheetOpen}>
                <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                            {editingUser ? <UserCog className="w-5 h-5 text-primary" /> : <Plus className="w-5 h-5 text-primary" />}
                            {editingUser ? "Edit User" : "Create New User"}
                        </SheetTitle>
                        <SheetDescription>
                            {editingUser ? "Make changes to the user's account details." : "Add a new user to the system."}
                        </SheetDescription>
                    </SheetHeader>

                    <form onSubmit={handleSubmit} className="space-y-6 mt-6">
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="first_name">First Name</Label>
                                    <Input
                                        id="first_name"
                                        placeholder="John"
                                        value={formData.first_name}
                                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="last_name">Last Name</Label>
                                    <Input
                                        id="last_name"
                                        placeholder="Doe"
                                        value={formData.last_name}
                                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address <span className="text-red-500">*</span></Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="john.doe@example.com"
                                    required
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password">
                                    {editingUser ? "Password (leave blank to keep current)" : "Password"}
                                    {!editingUser && <span className="text-red-500">*</span>}
                                </Label>
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder="••••••••"
                                    required={!editingUser}
                                    minLength={8}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="role">Role</Label>
                                <Select
                                    value={formData.role}
                                    onValueChange={(val) => setFormData({ ...formData, role: val || "staff" })}
                                >
                                    <SelectTrigger>
                                        <SelectValue>
                                            {formData.role === 'admin' ? 'Admin' : 'Staff'}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="staff">Staff</SelectItem>
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
                                        <SelectTrigger>
                                            <SelectValue>
                                                {formData.is_active ? 'Active' : 'Inactive'}
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">Active</SelectItem>
                                            <SelectItem value="inactive">Inactive</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        <SheetFooter>
                            <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {editingUser ? "Save Changes" : "Create User"}
                            </Button>
                        </SheetFooter>
                    </form>
                </SheetContent>
            </Sheet>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteUserOpen} onOpenChange={setDeleteUserOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-red-500">
                            <ShieldAlert className="h-5 w-5" />
                            Delete User
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete {userToDelete?.first_name} {userToDelete?.last_name}?
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                            Delete User
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
