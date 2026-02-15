"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/store/auth-store";
import { useDenseModeStore } from "@/store/dense-mode-store";
import { createOrder, type OrderCreatePayload } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Pill, TestTube, ImageIcon } from "lucide-react";

interface Props {
    patientId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type OrderType = "medication" | "lab" | "imaging";

const TABS: { value: OrderType; label: string; icon: typeof Pill }[] = [
    { value: "medication", label: "Medication", icon: Pill },
    { value: "lab", label: "Lab", icon: TestTube },
    { value: "imaging", label: "Imaging", icon: ImageIcon },
];

const ROUTES = ["Oral", "IV", "IM", "SC", "Topical", "Inhaled", "Rectal", "Sublingual"];
const FREQUENCIES = ["Once", "BID", "TID", "QID", "Q4H", "Q6H", "Q8H", "Q12H", "Daily", "Weekly", "PRN"];
const LAB_CATEGORIES = ["Hematology", "Chemistry", "Microbiology", "Urinalysis", "Coagulation", "Immunology", "Other"];

export function NewOrderDialog({ patientId, open, onOpenChange }: Props) {
    const token = useAuthStore((s) => s.token);
    const resetTimeline = useDenseModeStore((s) => s.resetTimeline);
    const [saving, setSaving] = useState(false);
    const [orderType, setOrderType] = useState<OrderType>("medication");
    const [name, setName] = useState("");
    const [dosage, setDosage] = useState("");
    const [frequency, setFrequency] = useState("");
    const [route, setRoute] = useState("");
    const [category, setCategory] = useState("");
    const [notes, setNotes] = useState("");

    const resetForm = () => {
        setOrderType("medication");
        setName("");
        setDosage("");
        setFrequency("");
        setRoute("");
        setCategory("");
        setNotes("");
    };

    const handleSubmit = async () => {
        if (!token) return;
        if (!name.trim()) {
            toast.error("Name is required");
            return;
        }

        setSaving(true);
        try {
            const payload: OrderCreatePayload = {
                order_type: orderType,
                name: name.trim(),
                dosage: dosage || undefined,
                frequency: frequency || undefined,
                route: route || undefined,
                category: category || undefined,
                notes: notes || undefined,
            };
            await createOrder(patientId, payload, token);
            toast.success(`${orderType.charAt(0).toUpperCase() + orderType.slice(1)} order created`);
            resetForm();
            onOpenChange(false);
            resetTimeline();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create order");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New Order</DialogTitle>
                    <DialogDescription>
                        Create a new medication, lab, or imaging order.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Type tabs */}
                    <div className="flex gap-1 p-1 bg-muted rounded-lg">
                        {TABS.map((tab) => {
                            const Icon = tab.icon;
                            const active = orderType === tab.value;
                            return (
                                <button
                                    key={tab.value}
                                    type="button"
                                    onClick={() => setOrderType(tab.value)}
                                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                        active
                                            ? "bg-background shadow text-foreground"
                                            : "text-muted-foreground hover:text-foreground"
                                    }`}
                                >
                                    <Icon className="size-3.5" />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Common name field */}
                    <div className="space-y-2">
                        <Label>
                            {orderType === "medication" ? "Medication Name" : orderType === "lab" ? "Test Name" : "Study Name"}
                            <span className="text-red-500 ml-0.5">*</span>
                        </Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={
                                orderType === "medication"
                                    ? "e.g., Amoxicillin"
                                    : orderType === "lab"
                                        ? "e.g., CBC, BMP"
                                        : "e.g., Chest X-Ray"
                            }
                        />
                    </div>

                    {/* Medication-specific fields */}
                    {orderType === "medication" && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Dosage</Label>
                                    <Input
                                        value={dosage}
                                        onChange={(e) => setDosage(e.target.value)}
                                        placeholder="e.g., 500mg"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Route</Label>
                                    <Select value={route} onValueChange={(v) => { if (v) setRoute(v); }}>
                                        <SelectTrigger>
                                            {route ? <SelectValue /> : <span className="text-muted-foreground">Select route</span>}
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ROUTES.map((r) => (
                                                <SelectItem key={r} value={r}>{r}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Frequency</Label>
                                <Select value={frequency} onValueChange={(v) => { if (v) setFrequency(v); }}>
                                    <SelectTrigger>
                                        {frequency ? <SelectValue /> : <span className="text-muted-foreground">Select frequency</span>}
                                    </SelectTrigger>
                                    <SelectContent>
                                        {FREQUENCIES.map((f) => (
                                            <SelectItem key={f} value={f}>{f}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </>
                    )}

                    {/* Lab-specific fields */}
                    {orderType === "lab" && (
                        <div className="space-y-2">
                            <Label>Category</Label>
                            <Select value={category} onValueChange={(v) => { if (v) setCategory(v); }}>
                                <SelectTrigger>
                                    {category ? <SelectValue /> : <span className="text-muted-foreground">Select category</span>}
                                </SelectTrigger>
                                <SelectContent>
                                    {LAB_CATEGORIES.map((c) => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Notes for all */}
                    <div className="space-y-2">
                        <Label>Notes</Label>
                        <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Additional instructions or notes..."
                            className="min-h-[60px] resize-none"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving}>
                        {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
                        Create Order
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
