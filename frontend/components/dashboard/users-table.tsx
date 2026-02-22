"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
    restoreUser,
    bulkDeleteUsers,
    bulkRestoreUsers,
    purgeDeletedUsers,
    createUserInvite,
    fetchUserInvites,
    resendUserInvite,
    revokeUserInvite,
    verifyUser,
    getErrorMessage,
    createUser,
    updateUser,
    UserCreate,
    UserUpdate,
    User,
    UserInviteItem,
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
    UserCog,
    Mail,
    Plus,
    Trash2,
    Pencil,
    Copy,
    XCircle,
    X,
    BadgeCheck,
    Clock,
    Link2,
    FileDown,
    ArrowUpDown,
    Users,
    RotateCcw,
    RefreshCw,
} from "lucide-react";


import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import { buildProfileSeed, getProfileOrbStyle } from "@/components/ui/profile-avatar-orb";
import { Button } from "@/components/ui/button";
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { DataTableViewOptions } from "./data-table-view-options";
import { useLanguageStore } from "@/store/language-store";
import type { AppLanguage } from "@/store/language-config";



// --- Constants & Helpers ---

const tr = (language: AppLanguage, en: string, th: string) =>
    language === "th" ? th : en;

const ROLE_OPTIONS = [
    { value: "admin", label: "Administrator" },
    { value: "doctor", label: "Doctor" },
    { value: "nurse", label: "Nurse" },
    { value: "pharmacist", label: "Pharmacist" },
    { value: "medical_technologist", label: "Medical Technologist" },
    { value: "psychologist", label: "Psychologist" },
    { value: "staff", label: "Staff" },
];

const CLINICAL_ROLE_OPTIONS = ROLE_OPTIONS.filter((option) =>
    ["doctor", "nurse", "pharmacist", "medical_technologist", "psychologist"].includes(option.value)
);

const ROLE_LABEL_MAP: Record<string, string> = ROLE_OPTIONS.reduce(
    (acc, curr) => ({ ...acc, [curr.value]: curr.label }),
    {}
);

const ROLE_LABEL_MAP_TH: Record<string, string> = {
    admin: "ผู้ดูแลระบบ",
    doctor: "แพทย์",
    nurse: "พยาบาล",
    pharmacist: "เภสัชกร",
    medical_technologist: "นักเทคนิคการแพทย์",
    psychologist: "นักจิตวิทยา",
    staff: "เจ้าหน้าที่",
};

const STATUS_LABEL_MAP_TH: Record<string, string> = {
    verified: "ยืนยันแล้ว",
    pending: "รอตรวจสอบ",
    unverified: "ยังไม่ยืนยัน",
};

const isClinicalRole = (role: string) => {
    return CLINICAL_ROLE_OPTIONS.some((option) => option.value === role);
};

const TEAM_MEMBER_COLORS = [
    "bg-emerald-200 text-emerald-800",
    "bg-amber-200 text-amber-800",
    "bg-violet-200 text-violet-800",
] as const;

const getDisplayName = (
    firstName: string | null | undefined,
    lastName: string | null | undefined,
    email: string | null | undefined,
    fallback: string,
) => `${firstName ?? ""} ${lastName ?? ""}`.trim() || email || fallback;

const showTeamUpdateToast = ({
    title,
    message,
    members,
}: {
    title: string;
    message: string;
    members: string[];
}) => {
    const memberChips = members
        .filter((member) => member.trim().length > 0)
        .slice(0, 3)
        .map((member, index) => ({
            name: member,
            initials: member.trim().charAt(0).toUpperCase() || "?",
            color: TEAM_MEMBER_COLORS[index % TEAM_MEMBER_COLORS.length],
        }));

    toast.info(title, {
        fill: "#f3f4f6",
        duration: 12000,
        icon: (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-sky-100 text-sky-500">
                <Users className="size-3.5" />
            </span>
        ),
        styles: {
            title: "!text-sky-500 !font-semibold !tracking-tight",
            badge: "!bg-sky-100/80 !text-sky-500",
            description: "!text-neutral-700",
        },
        description: (
            <div className="flex items-center gap-3 pr-5">
                <div className="flex -space-x-2">
                    {memberChips.map((member) => (
                        <span
                            key={member.name}
                            className={cn(
                                "inline-flex size-7 items-center justify-center rounded-full border-2 border-zinc-100 text-[11px] font-semibold shadow-sm",
                                member.color
                            )}
                            aria-label={member.name}
                            title={member.name}
                        >
                            {member.initials}
                        </span>
                    ))}
                </div>
                <p className="text-sm leading-snug text-neutral-600">{message}</p>
            </div>
        ),
    });
};

const INVITE_STATUS_LABEL_MAP: Record<string, string> = {
    active: "Active",
    expired: "Expired",
    closed: "Closed",
};

const getRoleLabelByLanguage = (role: string, language: AppLanguage): string => {
    if (language === "th") {
        return ROLE_LABEL_MAP_TH[role] || role;
    }
    return ROLE_LABEL_MAP[role] || role.charAt(0).toUpperCase() + role.slice(1);
};

const getVerificationStatusLabel = (status: string, language: AppLanguage): string => {
    if (language === "th") {
        return STATUS_LABEL_MAP_TH[status] || status;
    }
    return status;
};

const getInviteStatusLabel = (status: string, language: AppLanguage): string => {
    const englishLabel = INVITE_STATUS_LABEL_MAP[status] ?? status;
    if (language !== "th") return englishLabel;
    if (status === "active") return "ใช้งาน";
    if (status === "expired") return "หมดอายุ";
    if (status === "closed") return "ปิดแล้ว";
    return englishLabel;
};

const getInviteStatusFilterLabel = (
    status: "active" | "expired" | "closed" | "all",
    language: AppLanguage
): string => {
    if (status === "all") return tr(language, "All", "ทั้งหมด");
    return getInviteStatusLabel(status, language);
};

const INVITE_ERROR_MESSAGE_RULES: Array<{
    pattern: RegExp;
    en: string;
    th: string;
}> = [
    {
        pattern: /invite onboarding is restricted to clinical specialist roles in this phase|clinical specialist roles/i,
        en: "Invites are currently limited to clinical specialist roles.",
        th: "ขณะนี้ระบบอนุญาตส่งคำเชิญเฉพาะบทบาทสายคลินิกเท่านั้น",
    },
    {
        pattern: /invite.*expired|expired invite|link.*expired/i,
        en: "This invite has expired. Please create a new invite link.",
        th: "คำเชิญนี้หมดอายุแล้ว กรุณาสร้างลิงก์คำเชิญใหม่",
    },
    {
        pattern: /invite.*closed|invite.*revoked|already revoked/i,
        en: "This invite is no longer active.",
        th: "คำเชิญนี้ไม่อยู่ในสถานะใช้งานแล้ว",
    },
];

const getInviteErrorMessage = (
    error: unknown,
    language: AppLanguage,
    fallbackEn: string,
    fallbackTh: string
): string => {
    const fallback = language === "th" ? fallbackTh : fallbackEn;
    const message = getErrorMessage(error, fallback);
    for (const rule of INVITE_ERROR_MESSAGE_RULES) {
        if (rule.pattern.test(message)) {
            return language === "th" ? rule.th : rule.en;
        }
    }
    return message;
};

const formatInviteTimestamp = (value?: string | null, language: AppLanguage = "en"): string => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString(language === "th" ? "th-TH" : "en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

// --- Component ---

export function UsersTable() {
    const { role: currentUserRole, token } = useAuthStore();
    const language = useLanguageStore((state) => state.language);

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
    const [generatedInviteUrl, setGeneratedInviteUrl] = useState("");
    const [inviteItems, setInviteItems] = useState<UserInviteItem[]>([]);
    const [isInviteListLoading, setIsInviteListLoading] = useState(false);
    const [inviteStatusFilter, setInviteStatusFilter] = useState<"active" | "expired" | "closed" | "all">("active");

    const [isBulkDeleting, setIsBulkDeleting] = useState(false);
    const [isBulkRestoring, setIsBulkRestoring] = useState(false);
    const [roleFilter, setRoleFilter] = useState("clinical");
    const [statusFilterLocal, setStatusFilterLocal] = useState("all");
    const [accountView, setAccountView] = useState<"active" | "all" | "deleted">("active");
    const [searchLocal, setSearchLocal] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
    const [bulkDeleteConfirmText, setBulkDeleteConfirmText] = useState("");
    const [pendingBulkDeleteUsers, setPendingBulkDeleteUsers] = useState<User[]>([]);
    const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
    const [purgeConfirmText, setPurgeConfirmText] = useState("");
    const [purgeReason, setPurgeReason] = useState("");
    const [purgeOlderThanDays, setPurgeOlderThanDays] = useState(90);
    const [isPurging, setIsPurging] = useState(false);
    const [hasExportedForPurge, setHasExportedForPurge] = useState(false);

    // Form Data State
    interface UserFormData extends Partial<User> {
        password?: string;
    }

    const [formData, setFormData] = useState<UserFormData>({
        email: "",
        first_name: "",
        last_name: "",
        password: "",
        role: "doctor",
        is_active: true,
        specialty: "",
        department: "",
        license_no: "",
        license_expiry: "",
        verification_status: "unverified",
    });

    const [inviteFormData, setInviteFormData] = useState({
        email: "",
        role: "doctor",
    });

    // Load Data
    const loadUsers = useCallback(async () => {
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
                q: debouncedSearch.trim() || undefined,
                sort: sortField,
                order: sorting.length > 0 && sorting[0].desc ? "desc" : "asc",
                clinical_only: true,
                role: roleFilter !== "clinical" ? roleFilter : undefined,
                verification_status: statusFilterLocal !== "all" ? statusFilterLocal : undefined,
                include_deleted: accountView !== "active",
                deleted_only: accountView === "deleted",
            }, token);

            // Ensure type compatibility by handling nulls if necessary, though User from API should match User in state
            setUsers(res.items || []);
            setTotal(res.total || 0);
        } catch {
            toast.error(tr(language, "Error", "ข้อผิดพลาด"), {
                description: tr(language, "Failed to load users.", "โหลดข้อมูลผู้ใช้ไม่สำเร็จ"),
            });
        } finally {
            setLoading(false);
        }
    }, [
        token,
        sorting,
        pagination.pageIndex,
        pagination.pageSize,
        debouncedSearch,
        roleFilter,
        statusFilterLocal,
        accountView,
        language,
    ]);

    const loadInviteItems = useCallback(async () => {
        if (!token || !isInviteSheetOpen) return;
        setIsInviteListLoading(true);
        try {
            const response = await fetchUserInvites(
                {
                    page: 1,
                    limit: 50,
                    status_filter: inviteStatusFilter,
                },
                token
            );
            setInviteItems(response.items ?? []);
        } catch (error) {
            toast.error(tr(language, "Load failed", "โหลดไม่สำเร็จ"), {
                description: getInviteErrorMessage(
                    error,
                    language,
                    "Unable to load invite records.",
                    "ไม่สามารถโหลดรายการคำเชิญได้"
                ),
            });
        } finally {
            setIsInviteListLoading(false);
        }
    }, [token, isInviteSheetOpen, inviteStatusFilter, language]);

    useEffect(() => {
        void loadUsers();
    }, [loadUsers]);

    useEffect(() => {
        if (!isInviteSheetOpen) return;
        void loadInviteItems();
    }, [isInviteSheetOpen, loadInviteItems]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearch(searchLocal.trim());
        }, 350);

        return () => window.clearTimeout(timeoutId);
    }, [searchLocal]);

    useEffect(() => {
        setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    }, [debouncedSearch, roleFilter, statusFilterLocal, accountView]);


    // --- Handlers from Original ---

    const handleOpenEdit = useCallback((user: User) => {
        setEditingUser(user);
        setFormData({ ...user, password: "" }); // Clear password for security
        setSheetOpen(true);
    }, []);

    const confirmDelete = useCallback(async (user: User) => {
        if (!token) {
            toast.error(tr(language, "Delete failed", "ลบไม่สำเร็จ"), {
                description: tr(language, "Not authenticated. Please sign in again.", "ยังไม่ได้ยืนยันตัวตน กรุณาเข้าสู่ระบบอีกครั้ง"),
            });
            return;
        }

        try {
            await deleteUser(user.id, token);
            toast.success(tr(language, "Success", "สำเร็จ"), {
                description: tr(language, "User deleted successfully", "ลบผู้ใช้สำเร็จ"),
            });
            loadUsers();
        } catch (error) {
            toast.error(tr(language, "Delete failed", "ลบไม่สำเร็จ"), {
                description: getErrorMessage(error, "ไม่สามารถลบผู้ใช้ได้"),
            });
        }
    }, [token, language, loadUsers]);

    const handleDelete = useCallback((user: User) => {
        const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email;
        toast.destructiveAction(tr(language, "Delete user?", "ลบผู้ใช้ใช่ไหม?"), {
            description: tr(
                language,
                `Are you sure you want to delete ${fullName}?`,
                `ยืนยันการลบผู้ใช้ ${fullName} ใช่หรือไม่?`
            ),
            button: {
                title: tr(language, "Delete User", "ลบผู้ใช้"),
                onClick: () => {
                    void confirmDelete(user);
                },
            },
            duration: 9000,
        });
    }, [language, confirmDelete]);

    const confirmRestore = useCallback(async (user: User) => {
        if (!token) {
            toast.error(tr(language, "Restore failed", "กู้คืนไม่สำเร็จ"), {
                description: tr(language, "Not authenticated. Please sign in again.", "ยังไม่ได้ยืนยันตัวตน กรุณาเข้าสู่ระบบอีกครั้ง"),
            });
            return;
        }

        try {
            const restored = await restoreUser(user.id, token);
            const usingRetiredEmail = restored.email.startsWith("deleted+");
            toast.success(tr(language, "User restored", "กู้คืนผู้ใช้แล้ว"), {
                description: usingRetiredEmail
                    ? tr(language, "Account restored. Please edit email before giving access to this user.", "กู้คืนบัญชีแล้ว กรุณาแก้ไขอีเมลก่อนให้สิทธิ์ผู้ใช้นี้")
                    : tr(language, "User restored successfully.", "กู้คืนผู้ใช้สำเร็จ"),
            });
            setRowSelection({});
            loadUsers();
        } catch (error) {
            toast.error(tr(language, "Restore failed", "กู้คืนไม่สำเร็จ"), {
                description: getErrorMessage(error, "ไม่สามารถกู้คืนผู้ใช้ได้"),
            });
        }
    }, [token, language, loadUsers]);

    const requestRestore = useCallback((user: User) => {
        const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email;
        toast.action(tr(language, "Restore user?", "กู้คืนผู้ใช้ใช่ไหม?"), {
            description: tr(
                language,
                `Restore ${fullName} back to active users?`,
                `ต้องการกู้คืน ${fullName} กลับเป็นผู้ใช้ที่ใช้งานอยู่หรือไม่?`
            ),
            button: {
                title: tr(language, "Restore User", "กู้คืนผู้ใช้"),
                onClick: () => {
                    void confirmRestore(user);
                },
            },
            duration: 9000,
        });
    }, [language, confirmRestore]);

    const handleVerifyUser = useCallback(async (user: User) => {
        if (!token) {
            toast.error(tr(language, "Verification failed", "ยืนยันไม่สำเร็จ"), {
                description: tr(language, "Not authenticated. Please sign in again.", "ยังไม่ได้ยืนยันตัวตน กรุณาเข้าสู่ระบบอีกครั้ง"),
            });
            return;
        }

        try {
            await verifyUser(user.id, token);
            const displayName = getDisplayName(
                user.first_name,
                user.last_name,
                user.email,
                tr(language, "New member", "สมาชิกใหม่")
            );
            showTeamUpdateToast({
                title: tr(language, "Verification Complete", "ยืนยันเสร็จสมบูรณ์"),
                members: [displayName],
                message: tr(
                    language,
                    `${displayName} is now verified and ready for assignments.`,
                    `${displayName} ได้รับการยืนยันแล้วและพร้อมสำหรับการมอบหมายงาน`
                ),
            });
            loadUsers();
        } catch (err) {
            toast.error(tr(language, "Verification failed", "ยืนยันไม่สำเร็จ"), {
                description: getErrorMessage(err, "ไม่สามารถยืนยันผู้ใช้ได้"),
            });
        }
    }, [token, language, loadUsers]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token) {
            toast.error(tr(language, "Save failed", "บันทึกไม่สำเร็จ"), {
                description: tr(language, "Not authenticated. Please sign in again.", "ยังไม่ได้ยืนยันตัวตน กรุณาเข้าสู่ระบบอีกครั้ง"),
                duration: 10000,
            });
            return;
        }
        setIsSubmitting(true);
        try {
            const normalizedEmail = formData.email?.trim();
            if (!normalizedEmail) {
                throw new Error(tr(language, "Email is required.", "จำเป็นต้องกรอกอีเมล"));
            }

            const normalizedPassword = formData.password?.trim();
            if (!editingUser && !normalizedPassword) {
                throw new Error(tr(language, "Password is required.", "จำเป็นต้องกรอกรหัสผ่าน"));
            }
            if (normalizedPassword && normalizedPassword.length < 8) {
                throw new Error(tr(language, "Password must be at least 8 characters.", "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"));
            }

            const basePayload: Omit<UserCreate, "password" | "email"> & { email: string } = {
                email: normalizedEmail,
                first_name: formData.first_name?.trim() || undefined,
                last_name: formData.last_name?.trim() || undefined,
                role: formData.role || "doctor",
                is_active: formData.is_active ?? true,
                specialty: formData.specialty?.trim() || undefined,
                department: formData.department?.trim() || undefined,
                license_no: formData.license_no?.trim() || undefined,
                license_expiry: formData.license_expiry || undefined,
                verification_status: formData.verification_status || undefined,
            };

            if (editingUser) {
                const updatePayload: UserUpdate = { ...basePayload };
                if (normalizedPassword) {
                    updatePayload.password = normalizedPassword;
                }
                await updateUser(editingUser.id, updatePayload, token);
            } else {
                const createPayload: UserCreate = {
                    ...basePayload,
                    password: normalizedPassword!,
                };
                await createUser(createPayload, token);
            }

            const roleLabel = ROLE_LABEL_MAP[String(basePayload.role ?? "doctor")] ?? "Doctor";
            const displayName = getDisplayName(
                basePayload.first_name,
                basePayload.last_name,
                basePayload.email,
                tr(language, "New member", "สมาชิกใหม่")
            );
            if (editingUser) {
                toast.success(tr(language, "User updated", "อัปเดตผู้ใช้แล้ว"), {
                    description: tr(language, `${displayName} details were saved successfully.`, `บันทึกข้อมูลของ ${displayName} สำเร็จ`),
                });
            } else {
                showTeamUpdateToast({
                    title: tr(language, "Team Update", "อัปเดตทีม"),
                    members: [displayName],
                    message: tr(language, `${displayName} joined as ${roleLabel}.`, `${displayName} เข้าร่วมในบทบาท ${getRoleLabelByLanguage(String(basePayload.role ?? "doctor"), language)}`),
                });
            }
            setSheetOpen(false);
            loadUsers();
        } catch (error: unknown) {
            const message = getErrorMessage(error, "ไม่สามารถบันทึกข้อมูลผู้ใช้ได้");
            toast.error(tr(language, "Save failed", "บันทึกไม่สำเร็จ"), { description: message, duration: 10000 });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCreateInviteRequest = (e: React.FormEvent) => {
        e.preventDefault();
        if (isInviteSubmitting) return;
        toast.action(tr(language, "Generate invite link?", "สร้างลิงก์เชิญใช่ไหม?"), {
            description: tr(
                language,
                `Create invite for ${inviteFormData.email} (${ROLE_LABEL_MAP[inviteFormData.role] ?? inviteFormData.role}).`,
                `สร้างคำเชิญสำหรับ ${inviteFormData.email} (${getRoleLabelByLanguage(inviteFormData.role, language)})`
            ),
            button: {
                title: tr(language, "Confirm & Generate", "ยืนยันและสร้าง"),
                onClick: () => {
                    void handleConfirmCreateInvite();
                },
            },
            duration: 9000,
        });
    };

    const handleConfirmCreateInvite = async () => {
        if (!token) {
            toast.error(tr(language, "Invite failed", "คำเชิญไม่สำเร็จ"), {
                description: tr(language, "Not authenticated. Please sign in again.", "ยังไม่ได้ยืนยันตัวตน กรุณาเข้าสู่ระบบอีกครั้ง"),
            });
            return;
        }

        setIsInviteSubmitting(true);
        try {
            const data = await createUserInvite(
                { email: inviteFormData.email, role: inviteFormData.role },
                token
            );
            setGeneratedInviteUrl(data.invite_url);
            showTeamUpdateToast({
                title: tr(language, "Invite Ready", "คำเชิญพร้อมใช้งาน"),
                members: [inviteFormData.email],
                message: tr(language, `Invite link generated for ${inviteFormData.email}.`, `สร้างลิงก์เชิญสำหรับ ${inviteFormData.email} แล้ว`),
            });
            await loadInviteItems();
        } catch (error) {
            toast.error(tr(language, "Invite failed", "คำเชิญไม่สำเร็จ"), {
                description: getInviteErrorMessage(
                    error,
                    language,
                    "Unable to create invite link.",
                    "ไม่สามารถสร้างลิงก์คำเชิญได้"
                ),
            });
        } finally {
            setIsInviteSubmitting(false);
        }
    };

    const handleCopyInviteUrl = () => {
        navigator.clipboard.writeText(generatedInviteUrl);
        toast.success(tr(language, "Copied", "คัดลอกแล้ว"), {
            description: tr(language, "Invite URL copied to clipboard", "คัดลอกลิงก์คำเชิญไปยังคลิปบอร์ดแล้ว"),
        });
    };

    const handleResendInvite = async (inviteId: string) => {
        if (!token || isInviteSubmitting) return;
        setIsInviteSubmitting(true);
        try {
            const data = await resendUserInvite(inviteId, token);
            setGeneratedInviteUrl(data.invite_url);
            toast.success(tr(language, "Invite resent", "ส่งคำเชิญซ้ำแล้ว"), {
                description: tr(language, "A new invite link was generated successfully.", "สร้างลิงก์คำเชิญใหม่สำเร็จ"),
            });
            await loadInviteItems();
        } catch (error) {
            toast.error(tr(language, "Resend failed", "ส่งซ้ำไม่สำเร็จ"), {
                description: getInviteErrorMessage(
                    error,
                    language,
                    "Unable to resend this invite.",
                    "ไม่สามารถส่งคำเชิญซ้ำได้"
                ),
            });
        } finally {
            setIsInviteSubmitting(false);
        }
    };

    const handleRevokeInvite = async (invite: UserInviteItem) => {
        if (!token || isInviteSubmitting) return;
        toast.destructiveAction(tr(language, "Revoke invite?", "เพิกถอนคำเชิญใช่ไหม?"), {
            description: tr(language, `Revoke invite for ${invite.email}?`, `เพิกถอนคำเชิญของ ${invite.email} ใช่หรือไม่?`),
            button: {
                title: tr(language, "Revoke", "เพิกถอน"),
                onClick: () => {
                    void (async () => {
                        setIsInviteSubmitting(true);
                        try {
                            await revokeUserInvite(invite.id, token);
                            toast.success(tr(language, "Invite revoked", "เพิกถอนคำเชิญแล้ว"), {
                                description: tr(language, `${invite.email} invite is no longer valid.`, `คำเชิญของ ${invite.email} ใช้งานไม่ได้แล้ว`),
                            });
                            await loadInviteItems();
                        } catch (error) {
                            toast.error(tr(language, "Revoke failed", "เพิกถอนไม่สำเร็จ"), {
                                description: getInviteErrorMessage(
                                    error,
                                    language,
                                    "Unable to revoke this invite.",
                                    "ไม่สามารถยกเลิกคำเชิญได้"
                                ),
                            });
                        } finally {
                            setIsInviteSubmitting(false);
                        }
                    })();
                },
            },
            duration: 9000,
        });
    };

    // Bulk Delete
    const handleBulkDelete = async (ids: string[], confirmText?: string) => {
        if (!token) {
            toast.error(tr(language, "Delete failed", "ลบไม่สำเร็จ"), {
                description: tr(language, "Not authenticated. Please sign in again.", "ยังไม่ได้ยืนยันตัวตน กรุณาเข้าสู่ระบบอีกครั้ง"),
            });
            return;
        }

        try {
            setIsBulkDeleting(true);
            const result = await bulkDeleteUsers(ids, token, confirmText);
            const skippedCount = result.skipped?.length ?? 0;
            if (skippedCount > 0) {
                const skippedPreview = result.skipped.slice(0, 3).join(" | ");
                const remainingSkipped = skippedCount - Math.min(skippedCount, 3);
                toast.warning(tr(language, "Delete partially completed", "ลบบางส่วนสำเร็จ"), {
                    description:
                        remainingSkipped > 0
                            ? tr(
                                language,
                                `Deleted ${result.deleted} user(s), skipped ${skippedCount}. ${skippedPreview} | and ${remainingSkipped} more`,
                                `ลบสำเร็จ ${result.deleted} รายการ ข้าม ${skippedCount} รายการ: ${skippedPreview} และอีก ${remainingSkipped} รายการ`
                            )
                            : tr(
                                language,
                                `Deleted ${result.deleted} user(s), skipped ${skippedCount}. ${skippedPreview}`,
                                `ลบสำเร็จ ${result.deleted} รายการ ข้าม ${skippedCount} รายการ: ${skippedPreview}`
                            ),
                    duration: 12000,
                });
            } else {
                toast.success(tr(language, "Success", "สำเร็จ"), {
                    description: tr(language, `Deleted ${result.deleted} user(s).`, `ลบผู้ใช้แล้ว ${result.deleted} รายการ`),
                });
            }
            setRowSelection({});
            setBulkDeleteDialogOpen(false);
            setBulkDeleteConfirmText("");
            setPendingBulkDeleteUsers([]);
            loadUsers();
        } catch (error) {
            toast.error(tr(language, "Delete failed", "ลบไม่สำเร็จ"), {
                description: getErrorMessage(error, "ไม่สามารถลบผู้ใช้แบบกลุ่มได้"),
            });
        } finally {
            setIsBulkDeleting(false);
        }
    };

    const requestBulkDelete = (selectedUsers: User[]) => {
        if (selectedUsers.length === 0 || isBulkDeleting || isBulkRestoring) return;

        const ids = selectedUsers.map((user) => user.id);
        const names = selectedUsers
            .map((user) => getDisplayName(user.first_name, user.last_name, user.email, tr(language, "New member", "สมาชิกใหม่")))
            .slice(0, 2);
        const remaining = selectedUsers.length - names.length;
        const namesPreview =
            remaining > 0
                ? tr(language, `${names.join(", ")} and ${remaining} more`, `${names.join(", ")} และอีก ${remaining} รายการ`)
                : names.join(", ");

        if (selectedUsers.length > 3) {
            setPendingBulkDeleteUsers(selectedUsers);
            setBulkDeleteConfirmText("");
            setBulkDeleteDialogOpen(true);
            return;
        }

        toast.destructiveAction(
            selectedUsers.length === 1
                ? tr(language, "Delete user?", "ลบผู้ใช้ใช่ไหม?")
                : tr(language, `Delete ${selectedUsers.length} users?`, `ลบผู้ใช้ ${selectedUsers.length} รายการใช่ไหม?`),
            {
                description: tr(language, `Are you sure you want to delete ${namesPreview}?`, `ยืนยันการลบ ${namesPreview} ใช่หรือไม่?`),
                button: {
                    title: selectedUsers.length === 1
                        ? tr(language, "Delete User", "ลบผู้ใช้")
                        : tr(language, "Delete Users", "ลบผู้ใช้"),
                    onClick: () => {
                        void handleBulkDelete(ids, "DELETE");
                    },
                },
                duration: 9000,
            }
        );
    };

    const handleBulkRestore = async (ids: string[]) => {
        if (!token) {
            toast.error(tr(language, "Restore failed", "กู้คืนไม่สำเร็จ"), {
                description: tr(language, "Not authenticated. Please sign in again.", "ยังไม่ได้ยืนยันตัวตน กรุณาเข้าสู่ระบบอีกครั้ง"),
            });
            return;
        }

        try {
            setIsBulkRestoring(true);
            const result = await bulkRestoreUsers(ids, token);
            const skippedCount = result.skipped?.length ?? 0;
            if (skippedCount > 0) {
                const skippedPreview = result.skipped.slice(0, 3).join(" | ");
                const remainingSkipped = skippedCount - Math.min(skippedCount, 3);
                toast.warning(tr(language, "Restore partially completed", "กู้คืนบางส่วนสำเร็จ"), {
                    description:
                        remainingSkipped > 0
                            ? tr(
                                language,
                                `Restored ${result.restored} user(s), skipped ${skippedCount}. ${skippedPreview} | and ${remainingSkipped} more`,
                                `กู้คืนสำเร็จ ${result.restored} รายการ ข้าม ${skippedCount} รายการ: ${skippedPreview} และอีก ${remainingSkipped} รายการ`
                            )
                            : tr(
                                language,
                                `Restored ${result.restored} user(s), skipped ${skippedCount}. ${skippedPreview}`,
                                `กู้คืนสำเร็จ ${result.restored} รายการ ข้าม ${skippedCount} รายการ: ${skippedPreview}`
                            ),
                    duration: 12000,
                });
            } else {
                toast.success(tr(language, "Users restored", "กู้คืนผู้ใช้แล้ว"), {
                    description: tr(language, `Restored ${result.restored} user(s).`, `กู้คืนผู้ใช้แล้ว ${result.restored} รายการ`),
                });
            }
            setRowSelection({});
            loadUsers();
        } catch (error) {
            toast.error(tr(language, "Restore failed", "กู้คืนไม่สำเร็จ"), {
                description: getErrorMessage(error, "ไม่สามารถกู้คืนผู้ใช้แบบกลุ่มได้"),
            });
        } finally {
            setIsBulkRestoring(false);
        }
    };

    const requestBulkRestore = (selectedUsers: User[]) => {
        if (selectedUsers.length === 0 || isBulkRestoring || isBulkDeleting) return;
        const ids = selectedUsers.map((user) => user.id);
        const names = selectedUsers
            .map((user) => getDisplayName(user.first_name, user.last_name, user.email, tr(language, "New member", "สมาชิกใหม่")))
            .slice(0, 2);
        const remaining = selectedUsers.length - names.length;
        const namesPreview =
            remaining > 0
                ? tr(language, `${names.join(", ")} and ${remaining} more`, `${names.join(", ")} และอีก ${remaining} รายการ`)
                : names.join(", ");

        toast.action(
            selectedUsers.length === 1
                ? tr(language, "Restore user?", "กู้คืนผู้ใช้ใช่ไหม?")
                : tr(language, `Restore ${selectedUsers.length} users?`, `กู้คืนผู้ใช้ ${selectedUsers.length} รายการใช่ไหม?`),
            {
                description: tr(language, `Restore ${namesPreview} to active accounts?`, `กู้คืน ${namesPreview} กลับเป็นบัญชีที่ใช้งานหรือไม่?`),
                button: {
                    title: selectedUsers.length === 1
                        ? tr(language, "Restore User", "กู้คืนผู้ใช้")
                        : tr(language, "Restore Users", "กู้คืนผู้ใช้"),
                    onClick: () => {
                        void handleBulkRestore(ids);
                    },
                },
                duration: 9000,
            }
        );
    };

    const escapeCsv = (value: string | null | undefined) => {
        const safe = (value ?? "").replace(/"/g, "\"\"");
        return `"${safe}"`;
    };

    const handleExportDeletedSnapshot = async () => {
        if (!token) return;
        try {
            let page = 1;
            const limit = 100;
            let total = 0;
            const rows: User[] = [];

            do {
                const response = await fetchUsers(
                    {
                        page,
                        limit,
                        include_deleted: true,
                        deleted_only: true,
                        clinical_only: true,
                    },
                    token
                );
                rows.push(...(response.items ?? []));
                total = response.total ?? 0;
                page += 1;
            } while (rows.length < total);

            const header = [
                "id",
                "email",
                "first_name",
                "last_name",
                "role",
                "is_active",
                "deleted_at",
                "deleted_by",
            ];
            const lines = rows.map((user) =>
                [
                    escapeCsv(user.id),
                    escapeCsv(user.email),
                    escapeCsv(user.first_name),
                    escapeCsv(user.last_name),
                    escapeCsv(user.role),
                    escapeCsv(String(user.is_active)),
                    escapeCsv(user.deleted_at ?? ""),
                    escapeCsv(user.deleted_by ?? ""),
                ].join(",")
            );

            const csv = [header.join(","), ...lines].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `deleted-users-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
            link.click();
            URL.revokeObjectURL(url);

            setHasExportedForPurge(true);
            toast.success(tr(language, "Export completed", "ส่งออกสำเร็จ"), {
                description: tr(language, `Snapshot exported (${rows.length} deleted users).`, `ส่งออก snapshot สำเร็จ (${rows.length} ผู้ใช้ที่ถูกลบ)`),
            });
        } catch (error) {
            toast.error(tr(language, "Export failed", "ส่งออกไม่สำเร็จ"), {
                description: getErrorMessage(error, "ไม่สามารถส่งออก snapshot ผู้ใช้ที่ถูกลบได้"),
            });
        }
    };

    const handlePurgeDeletedUsers = async () => {
        if (!token || isPurging) return;
        setIsPurging(true);
        try {
            const response = await purgeDeletedUsers(
                {
                    older_than_days: purgeOlderThanDays,
                    confirm_text: purgeConfirmText,
                    reason: purgeReason.trim(),
                },
                token
            );
            toast.success(tr(language, "Purge completed", "ลบถาวรสำเร็จ"), {
                description: tr(language, `Hard-deleted ${response.purged} user(s).`, `ลบถาวรแล้ว ${response.purged} รายการ`),
            });
            setPurgeDialogOpen(false);
            setPurgeConfirmText("");
            setPurgeReason("");
            setPurgeOlderThanDays(90);
            setHasExportedForPurge(false);
            loadUsers();
        } catch (error) {
            toast.error(tr(language, "Purge failed", "ลบถาวรไม่สำเร็จ"), {
                description: getErrorMessage(error, "ไม่สามารถ purge ผู้ใช้ที่ถูกลบได้"),
            });
        } finally {
            setIsPurging(false);
        }
    };

    // --- Columns Definition ---

    const columns: ColumnDef<User>[] = useMemo(() => [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    disabled={isBulkDeleting || isBulkRestoring}
                    aria-label={tr(language, "Select all", "เลือกทั้งหมด")}
                    className="translate-y-[2px]"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    disabled={isBulkDeleting || isBulkRestoring}
                    aria-label={tr(language, "Select row", "เลือกแถว")}
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
                        <span>{tr(language, "Name", "ชื่อ")}</span>
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            ),
            cell: ({ row }) => {
                const user = row.original;
                const profileSeed = buildProfileSeed(
                    user.id,
                    user.first_name,
                    user.last_name,
                    user.email
                );
                return (
                    <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                            <AvatarImage src={user.avatar_url || undefined} />
                            <AvatarFallback
                                className="transition-transform duration-200 hover:scale-[1.03]"
                                style={getProfileOrbStyle(profileSeed)}
                            >
                                <span className="sr-only">
                                    {getDisplayName(user.first_name, user.last_name, user.email, tr(language, "New member", "สมาชิกใหม่"))}
                                </span>
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                            <span className="font-medium truncate text-sm">
                                {user.first_name} {user.last_name || ""}
                            </span>
                            {user.deleted_at ? (
                                <span className="text-xs text-muted-foreground">
                                    {tr(language, "Deleted", "ลบเมื่อ")} {new Date(user.deleted_at).toLocaleString(language === "th" ? "th-TH" : "en-US")}
                                    {user.deleted_by ? tr(language, ` by ${user.deleted_by.slice(0, 8)}`, ` โดย ${user.deleted_by.slice(0, 8)}`) : ""}
                                </span>
                            ) : isClinicalRole(user.role) && user.specialty ? (
                                <span className="text-xs text-muted-foreground">{user.specialty}</span>
                            ) : null}
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
                    {tr(language, "Email", "อีเมล")}
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
            header: tr(language, "Role", "บทบาท"),
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
                        {getRoleLabelByLanguage(role, language)}
                    </Badge>
                );
            },
        },
        {
            accessorKey: "status",
            header: tr(language, "Status", "สถานะ"),
            cell: ({ row }) => {
                const user = row.original;
                if (user.deleted_at) {
                    return (
                        <Badge
                            variant="outline"
                            className="flex w-fit items-center gap-1 border-slate-500/30 text-slate-500 bg-slate-500/10"
                        >
                            <XCircle className="h-3 w-3" />
                            <span>{tr(language, "deleted", "ลบแล้ว")}</span>
                        </Badge>
                    );
                }
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
                        <span className="capitalize">
                            {getVerificationStatusLabel(status, language)}
                        </span>
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
                    {tr(language, "Created", "วันที่สร้าง")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const date = row.original.created_at;
                if (!date) return "-";
                return (
                    <div className="text-sm text-muted-foreground">
                        {new Date(date).toLocaleDateString(language === "th" ? "th-TH" : undefined)}
                    </div>
                )
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
                            <span className="sr-only">{tr(language, "Open menu", "เปิดเมนู")}</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                                <DropdownMenuLabel>{tr(language, "Actions", "การทำงาน")}</DropdownMenuLabel>
                                {user.deleted_at ? (
                                    <DropdownMenuItem
                                        onClick={() => requestRestore(user)}
                                        className="text-emerald-600 focus:text-emerald-600 focus:bg-emerald-50"
                                    >
                                        <RotateCcw className="mr-2 h-4 w-4" /> {tr(language, "Restore", "กู้คืน")}
                                    </DropdownMenuItem>
                                ) : (
                                    <>
                                        <DropdownMenuItem onClick={() => handleOpenEdit(user)}>
                                            <Pencil className="mr-2 h-4 w-4" /> {tr(language, "Edit", "แก้ไข")}
                                        </DropdownMenuItem>
                                        {(user.verification_status || "unverified") !== "verified" && (
                                            <DropdownMenuItem onClick={() => handleVerifyUser(user)}>
                                                <BadgeCheck className="mr-2 h-4 w-4 text-green-500" /> {tr(language, "Verify", "ยืนยัน")}
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => handleDelete(user)}
                                            className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" /> {tr(language, "Delete", "ลบ")}
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ], [
        currentUserRole,
        handleOpenEdit,
        handleDelete,
        handleVerifyUser,
        requestRestore,
        isBulkDeleting,
        isBulkRestoring,
        language,
    ]);


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
        enableRowSelection: () => !isBulkDeleting && !isBulkRestoring,
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
    const selectedUsers = selectedRows.map((row) => row.original);
    const selectedActiveUsers = selectedUsers.filter((user) => !user.deleted_at);
    const selectedDeletedUsers = selectedUsers.filter((user) => Boolean(user.deleted_at));
    const selectedIds = selectedUsers.map((user) => user.id);

    const hasActiveFilters =
        roleFilter !== "clinical" || statusFilterLocal !== "all" || accountView !== "active";
    const clearLocalFilters = () => {
        setRoleFilter("clinical");
        setStatusFilterLocal("all");
        setAccountView("active");
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border bg-card">
                {/* ── Header Bar ── */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:px-6 sm:py-3.5">
                    <div className="flex items-center gap-2 sm:gap-2.5 flex-1">
                        <Button variant="outline" size="icon" className="size-7 sm:size-8 shrink-0">
                            <UserCog className="size-4 sm:size-[18px] text-muted-foreground" />
                        </Button>
                        <span className="text-sm sm:text-base font-medium">{tr(language, "User Management", "การจัดการผู้ใช้")}</span>
                        <Badge variant="secondary" className="ml-1 text-[10px] sm:text-xs">
                            {total}
                        </Badge>
                        <div className="hidden md:flex items-center gap-1 rounded-md border border-input p-1 ml-1">
                            <Button
                                type="button"
                                variant={accountView === "active" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setAccountView("active")}
                            >
                                {tr(language, "Active", "ใช้งาน")}
                            </Button>
                            <Button
                                type="button"
                                variant={accountView === "deleted" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setAccountView("deleted")}
                            >
                                {tr(language, "Deleted", "ลบแล้ว")}
                            </Button>
                            <Button
                                type="button"
                                variant={accountView === "all" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setAccountView("all")}
                            >
                                {tr(language, "All", "ทั้งหมด")}
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 sm:flex-none">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 sm:size-5 text-muted-foreground" />
                            <Input
                                placeholder={tr(language, "Search users...", "ค้นหาผู้ใช้...")}
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
                                <span className="hidden sm:inline">{tr(language, "Filter", "ตัวกรอง")}</span>
                                {hasActiveFilters && (
                                    <span className="size-1.5 sm:size-2 rounded-full bg-primary" />
                                )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[220px]">
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>{tr(language, "Filter by Role", "กรองตามบทบาท")}</DropdownMenuLabel>
                                    <DropdownMenuCheckboxItem
                                        checked={roleFilter === "clinical"}
                                        onCheckedChange={() => setRoleFilter("clinical")}
                                    >
                                        {tr(language, "All Clinical Roles", "ทุกบทบาทสายคลินิก")}
                                    </DropdownMenuCheckboxItem>
                                    {CLINICAL_ROLE_OPTIONS.map((r) => (
                                        <DropdownMenuCheckboxItem
                                            key={r.value}
                                            checked={roleFilter === r.value}
                                            onCheckedChange={() => setRoleFilter(r.value)}
                                        >
                                            {getRoleLabelByLanguage(r.value, language)}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>{tr(language, "Filter by Status", "กรองตามสถานะ")}</DropdownMenuLabel>
                                    <DropdownMenuCheckboxItem
                                        checked={statusFilterLocal === "all"}
                                        onCheckedChange={() => setStatusFilterLocal("all")}
                                    >
                                        {tr(language, "All Statuses", "ทุกสถานะ")}
                                    </DropdownMenuCheckboxItem>
                                    {["verified", "pending", "unverified"].map((s) => (
                                        <DropdownMenuCheckboxItem
                                            key={s}
                                            checked={statusFilterLocal === s}
                                            onCheckedChange={() => setStatusFilterLocal(s)}
                                        >
                                            <span className="capitalize">{getVerificationStatusLabel(s, language)}</span>
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel>{tr(language, "Account View", "มุมมองบัญชี")}</DropdownMenuLabel>
                                    <DropdownMenuCheckboxItem
                                        checked={accountView === "active"}
                                        onCheckedChange={() => setAccountView("active")}
                                    >
                                        {tr(language, "Active only", "เฉพาะที่ใช้งาน")}
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        checked={accountView === "deleted"}
                                        onCheckedChange={() => setAccountView("deleted")}
                                    >
                                        {tr(language, "Deleted only", "เฉพาะที่ลบแล้ว")}
                                    </DropdownMenuCheckboxItem>
                                    <DropdownMenuCheckboxItem
                                        checked={accountView === "all"}
                                        onCheckedChange={() => setAccountView("all")}
                                    >
                                        {tr(language, "Active + Deleted", "ใช้งาน + ลบแล้ว")}
                                    </DropdownMenuCheckboxItem>
                                </DropdownMenuGroup>
                                {hasActiveFilters && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={clearLocalFilters} className="text-destructive">
                                            <X className="size-4 mr-2" />
                                            {tr(language, "Clear all filters", "ล้างตัวกรองทั้งหมด")}
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Bulk delete */}
                        {selectedActiveUsers.length > 0 && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 sm:h-9 gap-1.5 border-red-300/50 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                                disabled={isBulkDeleting || isBulkRestoring}
                                onClick={() => requestBulkDelete(selectedActiveUsers)}
                            >
                                {isBulkDeleting ? (
                                    <Loader2 className="size-3.5 sm:size-4 animate-spin" />
                                ) : (
                                    <Trash2 className="size-3.5 sm:size-4" />
                                )}
                                {isBulkDeleting
                                    ? tr(language, "Deleting...", "กำลังลบ...")
                                    : `${tr(language, "Delete", "ลบ")} (${selectedActiveUsers.length})`}
                            </Button>
                        )}

                        {/* Bulk restore */}
                        {selectedDeletedUsers.length > 0 && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 sm:h-9 gap-1.5 border-emerald-300/50 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                                disabled={isBulkDeleting || isBulkRestoring}
                                onClick={() => requestBulkRestore(selectedDeletedUsers)}
                            >
                                {isBulkRestoring ? (
                                    <Loader2 className="size-3.5 sm:size-4 animate-spin" />
                                ) : (
                                    <RotateCcw className="size-3.5 sm:size-4" />
                                )}
                                {isBulkRestoring
                                    ? tr(language, "Restoring...", "กำลังกู้คืน...")
                                    : `${tr(language, "Restore", "กู้คืน")} (${selectedDeletedUsers.length})`}
                            </Button>
                        )}

                        <div className="hidden sm:block w-px h-[22px] bg-border" />

                        {/* View options */}
                        <DataTableViewOptions table={table} />

                        {currentUserRole === "admin" && (
                            <>
                                <Button variant="outline" size="sm" className="h-8 sm:h-9 gap-1.5 sm:gap-2" onClick={() => setInviteSheetOpen(true)}>
                                    <Link2 className="size-3.5 sm:size-4" />
                                    <span className="hidden sm:inline">{tr(language, "Invite", "เชิญ")}</span>
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 sm:h-9 gap-1.5 sm:gap-2 border-red-300/50 text-red-600 hover:bg-red-500/10"
                                    onClick={() => {
                                        setPurgeDialogOpen(true);
                                        setHasExportedForPurge(false);
                                    }}
                                >
                                    <Trash2 className="size-3.5 sm:size-4" />
                                    <span className="hidden sm:inline">{tr(language, "Purge", "ล้างถาวร")}</span>
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* ── Active filter badges ── */}
                {hasActiveFilters && (
                    <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 pb-3">
                        <span className="text-[10px] sm:text-xs text-muted-foreground">{tr(language, "Filters:", "ตัวกรอง:")}</span>
                        {roleFilter !== "clinical" && (
                            <Badge
                                variant="secondary"
                                className="gap-1 cursor-pointer text-[10px] sm:text-xs h-5 sm:h-6"
                                onClick={() => setRoleFilter("clinical")}
                            >
                                {getRoleLabelByLanguage(roleFilter, language)}
                                <X className="size-2.5 sm:size-3" />
                            </Badge>
                        )}
                        {statusFilterLocal !== "all" && (
                            <Badge
                                variant="secondary"
                                className="gap-1 cursor-pointer text-[10px] sm:text-xs h-5 sm:h-6"
                                onClick={() => setStatusFilterLocal("all")}
                            >
                                <span className="capitalize">
                                    {getVerificationStatusLabel(statusFilterLocal, language)}
                                </span>
                                <X className="size-2.5 sm:size-3" />
                            </Badge>
                        )}
                        {accountView !== "active" && (
                            <Badge
                                variant="secondary"
                                className="gap-1 cursor-pointer text-[10px] sm:text-xs h-5 sm:h-6"
                                onClick={() => setAccountView("active")}
                            >
                                {accountView === "deleted"
                                    ? tr(language, "Deleted only", "เฉพาะที่ลบแล้ว")
                                    : tr(language, "Active + Deleted", "ใช้งาน + ลบแล้ว")}
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
                                            className={cn(
                                                "group hover:bg-muted/5",
                                                row.original.deleted_at && "opacity-70"
                                            )}
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
                                                    <Loader2 className="h-4 w-4 animate-spin" /> {tr(language, "Loading...", "กำลังโหลด...")}
                                                </div>
                                            ) : tr(language, "No users found.", "ไม่พบผู้ใช้")}
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
                                ? tr(language, `${selectedIds.length} selected`, `เลือกแล้ว ${selectedIds.length} รายการ`)
                                : tr(
                                    language,
                                    `${pagination.pageIndex * pagination.pageSize + 1}-${Math.min((pagination.pageIndex + 1) * pagination.pageSize, total)} of ${total}`,
                                    `${pagination.pageIndex * pagination.pageSize + 1}-${Math.min((pagination.pageIndex + 1) * pagination.pageSize, total)} จาก ${total}`
                                )}
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
            <Dialog
                open={bulkDeleteDialogOpen}
                onOpenChange={(open) => {
                    setBulkDeleteDialogOpen(open);
                    if (!open) {
                        setBulkDeleteConfirmText("");
                        setPendingBulkDeleteUsers([]);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{tr(language, "Confirm Bulk Delete", "ยืนยันการลบแบบกลุ่ม")}</DialogTitle>
                        <DialogDescription>
                            {tr(
                                language,
                                `You selected ${pendingBulkDeleteUsers.length} users. This action cannot be undone.`,
                                `คุณเลือกผู้ใช้ ${pendingBulkDeleteUsers.length} รายการ การกระทำนี้ไม่สามารถย้อนกลับได้`
                            )}{" "}
                            {tr(language, "Type", "พิมพ์")} <span className="font-semibold">DELETE</span> {tr(language, "to continue.", "เพื่อดำเนินการต่อ")}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="bulk-delete-confirm">{tr(language, "Confirmation text", "ข้อความยืนยัน")}</Label>
                        <Input
                            id="bulk-delete-confirm"
                            value={bulkDeleteConfirmText}
                            onChange={(event) => setBulkDeleteConfirmText(event.target.value)}
                            placeholder={tr(language, "Type DELETE", "พิมพ์ DELETE")}
                            autoComplete="off"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setBulkDeleteDialogOpen(false);
                                setBulkDeleteConfirmText("");
                                setPendingBulkDeleteUsers([]);
                            }}
                        >
                            {tr(language, "Cancel", "ยกเลิก")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={isBulkDeleting || bulkDeleteConfirmText !== "DELETE"}
                            onClick={() => {
                                void handleBulkDelete(
                                    pendingBulkDeleteUsers.map((user) => user.id),
                                    bulkDeleteConfirmText
                                );
                            }}
                        >
                            {isBulkDeleting
                                ? tr(language, "Deleting...", "กำลังลบ...")
                                : tr(language, "Delete Users", "ลบผู้ใช้")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={purgeDialogOpen}
                onOpenChange={(open) => {
                    setPurgeDialogOpen(open);
                    if (!open) {
                        setPurgeConfirmText("");
                        setPurgeReason("");
                        setPurgeOlderThanDays(90);
                        setHasExportedForPurge(false);
                    }
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-red-600">{tr(language, "Purge Deleted Users", "ลบถาวรผู้ใช้ที่ถูกลบแล้ว")}</DialogTitle>
                        <DialogDescription>
                            {tr(language, "Hard delete users older than N days.", "ลบถาวรผู้ใช้ที่ถูกลบแล้วเกิน N วัน")} {tr(language, "ต้อง export snapshot ก่อน และกรอกคำยืนยัน", "ต้องส่งออก snapshot ก่อน และกรอกคำยืนยัน")} <span className="font-semibold">PURGE</span>.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label htmlFor="purge_days">{tr(language, "Older than days", "เก่ากว่า (วัน)")}</Label>
                            <Input
                                id="purge_days"
                                type="number"
                                min={1}
                                max={3650}
                                value={purgeOlderThanDays}
                                onChange={(event) => setPurgeOlderThanDays(Number(event.target.value || 90))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="purge_reason">{tr(language, "Reason", "เหตุผล")}</Label>
                            <Input
                                id="purge_reason"
                                value={purgeReason}
                                onChange={(event) => setPurgeReason(event.target.value)}
                                placeholder="เช่น retention policy รอบไตรมาส"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="purge_confirm_text">{tr(language, "Confirm text", "ข้อความยืนยัน")}</Label>
                            <Input
                                id="purge_confirm_text"
                                value={purgeConfirmText}
                                onChange={(event) => setPurgeConfirmText(event.target.value)}
                                placeholder={tr(language, 'Type "PURGE"', 'พิมพ์ "PURGE"')}
                            />
                        </div>
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-muted-foreground">
                            ระบบบังคับให้ export รายการบัญชีที่ถูกลบก่อน purge ทุกครั้ง
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => void handleExportDeletedSnapshot()}
                        >
                            <FileDown className="mr-2 h-4 w-4" />
                            {tr(language, "Export deleted users snapshot", "ส่งออก snapshot ผู้ใช้ที่ถูกลบ")}
                        </Button>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setPurgeDialogOpen(false);
                                setHasExportedForPurge(false);
                            }}
                        >
                            {tr(language, "Cancel", "ยกเลิก")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={
                                isPurging ||
                                !hasExportedForPurge ||
                                purgeConfirmText !== "PURGE" ||
                                purgeReason.trim().length < 8
                            }
                            onClick={() => {
                                void handlePurgeDeletedUsers();
                            }}
                        >
                            {isPurging
                                ? tr(language, "Purging...", "กำลังลบถาวร...")
                                : tr(language, "Purge permanently", "ลบถาวร")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
                            {editingUser
                                ? tr(language, "Edit User", "แก้ไขผู้ใช้")
                                : tr(language, "Create New User", "สร้างผู้ใช้ใหม่")}
                        </SheetTitle>
                        <SheetDescription>
                            {editingUser
                                ? tr(language, "Make changes to the user's account details.", "แก้ไขรายละเอียดบัญชีของผู้ใช้")
                                : tr(language, "Add a new user to the system.", "เพิ่มผู้ใช้ใหม่เข้าสู่ระบบ")}
                        </SheetDescription>
                    </SheetHeader>

                    <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[calc(88vh-120px)]">
                        <div className="space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                <Label htmlFor="first_name">{tr(language, "First Name", "ชื่อจริง")}</Label>
                                <Input
                                    id="first_name"
                                    placeholder={tr(language, "John", "สมชาย")}
                                    value={formData.first_name || ""}
                                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                                />
                            </div>
                                <div className="space-y-2">
                                <Label htmlFor="last_name">{tr(language, "Last Name", "นามสกุล")}</Label>
                                <Input
                                    id="last_name"
                                    placeholder={tr(language, "Doe", "ใจดี")}
                                    value={formData.last_name || ""}
                                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                                />
                            </div>
                            </div>
                            {/* ... (Other form fields - mostly identical to logic above but reconstructed) ... */}
                            <div className="space-y-2">
                                <Label htmlFor="email">{tr(language, "Email Address", "อีเมล")} <span className="text-red-500">*</span></Label>
                                <Input
                                    id="email" type="email" placeholder={tr(language, "john.doe@example.com", "somchai@example.com")}
                                    required value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">
                                    {editingUser
                                        ? tr(language, "Password (leave blank to keep)", "รหัสผ่าน (เว้นว่างเพื่อคงเดิม)")
                                        : tr(language, "Password", "รหัสผ่าน")}
                                    {!editingUser && <span className="text-red-500">*</span>}
                                </Label>
                                <Input
                                    id="password" type="password" placeholder={tr(language, "••••••••", "••••••••")}
                                    required={!editingUser} minLength={8}
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="role">{tr(language, "Role", "บทบาท")}</Label>
                                <Select
                                    value={formData.role}
                                    onValueChange={(val) => setFormData({ ...formData, role: val || "doctor" })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {CLINICAL_ROLE_OPTIONS.map((r) => (
                                            <SelectItem key={r.value} value={r.value}>{getRoleLabelByLanguage(r.value, language)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {editingUser && (
                                <div className="space-y-2">
                                    <Label htmlFor="status">{tr(language, "Account Status", "สถานะบัญชี")}</Label>
                                    <Select
                                        value={formData.is_active ? "active" : "inactive"}
                                        onValueChange={(val) => setFormData({ ...formData, is_active: val === "active" })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">{tr(language, "Active", "ใช้งาน")}</SelectItem>
                                            <SelectItem value="inactive">{tr(language, "Inactive", "ไม่ใช้งาน")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            {isClinicalRole(formData.role || "") && (
                                <div className="space-y-4 rounded-lg border border-border/60 p-4 bg-muted/10">
                                    <p className="text-sm font-medium text-muted-foreground">{tr(language, "Professional Information", "ข้อมูลวิชาชีพ")}</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="specialty">{tr(language, "Specialty", "สาขา")}</Label>
                                            <Input id="specialty" value={formData.specialty || ""} onChange={e => setFormData({ ...formData, specialty: e.target.value })} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="department">{tr(language, "Department", "แผนก")}</Label>
                                            <Input id="department" value={formData.department || ""} onChange={e => setFormData({ ...formData, department: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="license_no">{tr(language, "License No.", "เลขใบอนุญาต")} <span className="text-red-500">*</span></Label>
                                            <Input id="license_no" required value={formData.license_no || ""} onChange={e => setFormData({ ...formData, license_no: e.target.value })} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="license_expiry">{tr(language, "License Expiry", "วันหมดอายุใบอนุญาต")}</Label>
                                            <Input type="date" id="license_expiry" value={formData.license_expiry || ""} onChange={e => setFormData({ ...formData, license_expiry: e.target.value })} />
                                        </div>
                                    </div>
                                    {editingUser && (
                                        <div className="space-y-2">
                                            <Label htmlFor="verification_status">{tr(language, "Verification Status", "สถานะการยืนยัน")}</Label>
                                            <Select value={formData.verification_status || "unverified"} onValueChange={val => setFormData({ ...formData, verification_status: val })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="unverified">{tr(language, "Unverified", "ยังไม่ยืนยัน")}</SelectItem>
                                                    <SelectItem value="pending">{tr(language, "Pending", "รอดำเนินการ")}</SelectItem>
                                                    <SelectItem value="verified">{tr(language, "Verified", "ยืนยันแล้ว")}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <SheetFooter className="px-0 pt-2 pb-0 sm:justify-end sm:flex-row">
                            <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>{tr(language, "Cancel", "ยกเลิก")}</Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {editingUser
                                    ? tr(language, "Save Changes", "บันทึกการเปลี่ยนแปลง")
                                    : tr(language, "Create User", "สร้างผู้ใช้")}
                            </Button>
                        </SheetFooter>
                    </form>
                </SheetContent>
            </Sheet>

            {/* Invite Sheet */}
            <Sheet open={isInviteSheetOpen} onOpenChange={setInviteSheetOpen}>
                <SheetContent side="center" className="w-[min(94vw,620px)] max-h-[84vh] p-0 overflow-hidden rounded-2xl border border-border/60 bg-background/95">
                    <SheetHeader className="px-6 pt-6 pb-3 border-b bg-muted/20">
                        <SheetTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" /> {tr(language, "Create Invite Link", "สร้างลิงก์เชิญ")}</SheetTitle>
                        <SheetDescription>{tr(language, "Only admins can generate registration links for approved healthcare users.", "เฉพาะผู้ดูแลระบบเท่านั้นที่สร้างลิงก์ลงทะเบียนสำหรับบุคลากรที่ได้รับอนุมัติได้")}</SheetDescription>
                    </SheetHeader>
                    <form onSubmit={handleCreateInviteRequest} className="p-6 space-y-5 overflow-y-auto max-h-[calc(84vh-120px)]">
                        <div className="space-y-2">
                            <Label htmlFor="invite_email">{tr(language, "Email", "อีเมล")} <span className="text-red-500">*</span></Label>
                            <Input id="invite_email" type="email" required value={inviteFormData.email || ""} onChange={e => setInviteFormData({ ...inviteFormData, email: e.target.value })} placeholder="doctor@hospital.org" />
                        </div>
                        <div className="space-y-2">
                            <Label>{tr(language, "Role", "บทบาท")}</Label>
                            <Select value={inviteFormData.role} onValueChange={val => setInviteFormData({ ...inviteFormData, role: val ?? "" })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{CLINICAL_ROLE_OPTIONS.map(r => <SelectItem key={r.value} value={r.value}>{getRoleLabelByLanguage(r.value, language)}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-sm text-muted-foreground">{tr(language, "Invite link expires in 24 hours (fixed by system policy).", "ลิงก์เชิญจะหมดอายุใน 24 ชั่วโมง (ตามนโยบายระบบ)")}</div>
                        {generatedInviteUrl && (
                            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">{tr(language, "Invite Link", "ลิงก์เชิญ")}</Label>
                                <Input value={generatedInviteUrl || ""} readOnly />
                                <Button type="button" variant="outline" className="w-full" onClick={handleCopyInviteUrl}><Copy className="mr-2 h-4 w-4" /> {tr(language, "Copy Link", "คัดลอกลิงก์")}</Button>
                            </div>
                        )}

                        <div className="space-y-3 rounded-md border border-border/70 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">{tr(language, "Invite Lifecycle", "วงจรคำเชิญ")}</Label>
                                <div className="flex items-center gap-2">
                                    <Select
                                        value={inviteStatusFilter}
                                        onValueChange={(value) => setInviteStatusFilter((value as "active" | "expired" | "closed" | "all") ?? "active")}
                                    >
                                        <SelectTrigger className="h-8 w-[130px]">
                                            <span className="truncate">
                                                {getInviteStatusFilterLabel(inviteStatusFilter, language)}
                                            </span>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="active">{tr(language, "Active", "ใช้งาน")}</SelectItem>
                                            <SelectItem value="expired">{tr(language, "Expired", "หมดอายุ")}</SelectItem>
                                            <SelectItem value="closed">{tr(language, "Closed", "ปิดแล้ว")}</SelectItem>
                                            <SelectItem value="all">{tr(language, "All", "ทั้งหมด")}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => void loadInviteItems()}>
                                        <RefreshCw className={cn("size-4", isInviteListLoading && "animate-spin")} />
                                    </Button>
                                </div>
                            </div>
                            {isInviteListLoading ? (
                                <p className="text-sm text-muted-foreground">{tr(language, "Loading invites...", "กำลังโหลดคำเชิญ...")}</p>
                            ) : inviteItems.length === 0 ? (
                                <p className="text-sm text-muted-foreground">{tr(language, "No invites in this status.", "ไม่มีคำเชิญในสถานะนี้")}</p>
                            ) : (
                                <div className="space-y-2">
                                    {inviteItems.map((invite) => (
                                        <div key={invite.id} className="rounded-md border border-border/70 p-3">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0 space-y-1">
                                                    <p className="text-sm font-medium truncate">{invite.email}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {getRoleLabelByLanguage(invite.role, language)}
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                                                            {getInviteStatusLabel(invite.status, language)}
                                                        </Badge>
                                                        <Badge variant="outline" className="text-[10px]">
                                                            {tr(language, "Expires", "หมดอายุ")} {formatInviteTimestamp(invite.expires_at, language)}
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={isInviteSubmitting || !isClinicalRole(invite.role)}
                                                        title={
                                                            !isClinicalRole(invite.role)
                                                                ? tr(
                                                                    language,
                                                                    "Resend is currently available only for clinical specialist roles.",
                                                                    "ขณะนี้การส่งซ้ำใช้ได้เฉพาะบทบาทสายคลินิก"
                                                                )
                                                                : undefined
                                                        }
                                                        onClick={() => void handleResendInvite(invite.id)}
                                                    >
                                                        <RotateCcw className="mr-1.5 size-3.5" />
                                                        {tr(language, "Resend", "ส่งซ้ำ")}
                                                    </Button>
                                                    {invite.status === "active" && (
                                                        <Button
                                                            type="button"
                                                            variant="destructive"
                                                            size="sm"
                                                            disabled={isInviteSubmitting}
                                                            onClick={() => void handleRevokeInvite(invite)}
                                                        >
                                                            {tr(language, "Revoke", "เพิกถอน")}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <SheetFooter className="px-0 pt-2 pb-0 sm:justify-end sm:flex-row">
                            <Button type="button" variant="outline" onClick={() => setInviteSheetOpen(false)}>{tr(language, "Close", "ปิด")}</Button>
                            <Button type="submit" disabled={isInviteSubmitting}>
                                {isInviteSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {tr(language, "Generate", "สร้าง")}
                            </Button>
                        </SheetFooter>
                    </form>
                </SheetContent>
            </Sheet>

        </div>
    );
}
