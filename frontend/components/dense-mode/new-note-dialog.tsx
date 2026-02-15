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
import { createNote, type NoteCreatePayload } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
    patientId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const NOTE_TYPES = [
    { value: "progress_note", label: "Progress Note" },
    { value: "admission_note", label: "Admission Note" },
    { value: "discharge_note", label: "Discharge Note" },
    { value: "consultation", label: "Consultation Note" },
    { value: "procedure_note", label: "Procedure Note" },
];

export function NewNoteDialog({ patientId, open, onOpenChange }: Props) {
    const token = useAuthStore((s) => s.token);
    const resetTimeline = useDenseModeStore((s) => s.resetTimeline);
    const [saving, setSaving] = useState(false);
    const [noteType, setNoteType] = useState("progress_note");
    const [subjective, setSubjective] = useState("");
    const [objective, setObjective] = useState("");
    const [assessment, setAssessment] = useState("");
    const [plan, setPlan] = useState("");

    const resetForm = () => {
        setNoteType("progress_note");
        setSubjective("");
        setObjective("");
        setAssessment("");
        setPlan("");
    };

    const handleSubmit = async () => {
        if (!token) return;
        if (!subjective && !objective && !assessment && !plan) {
            toast.error("Please fill in at least one SOAP section");
            return;
        }

        setSaving(true);
        try {
            const payload: NoteCreatePayload = {
                note_type: noteType,
                subjective: subjective || undefined,
                objective: objective || undefined,
                assessment: assessment || undefined,
                plan: plan || undefined,
                title: NOTE_TYPES.find((t) => t.value === noteType)?.label ?? "Note",
            };
            await createNote(patientId, payload, token);
            toast.success("Note created successfully");
            resetForm();
            onOpenChange(false);
            resetTimeline();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create note");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
            <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>New Progress Note</DialogTitle>
                    <DialogDescription>
                        Create a SOAP format clinical note for this patient.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Note Type</Label>
                        <Select value={noteType} onValueChange={(v) => { if (v) setNoteType(v); }}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {NOTE_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>Subjective (S)</Label>
                        <Textarea
                            value={subjective}
                            onChange={(e) => setSubjective(e.target.value)}
                            placeholder="Patient's complaints, symptoms, history..."
                            className="min-h-[80px] resize-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Objective (O)</Label>
                        <Textarea
                            value={objective}
                            onChange={(e) => setObjective(e.target.value)}
                            placeholder="Physical exam findings, vital signs, lab results..."
                            className="min-h-[80px] resize-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Assessment (A)</Label>
                        <Textarea
                            value={assessment}
                            onChange={(e) => setAssessment(e.target.value)}
                            placeholder="Diagnosis, differential diagnosis..."
                            className="min-h-[80px] resize-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Plan (P)</Label>
                        <Textarea
                            value={plan}
                            onChange={(e) => setPlan(e.target.value)}
                            placeholder="Treatment plan, medications, follow-up..."
                            className="min-h-[80px] resize-none"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving}>
                        {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
                        Save Note
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
