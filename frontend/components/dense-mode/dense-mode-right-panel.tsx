"use client";

import { useDenseModeStore } from "@/store/dense-mode-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pill, TestTube, FileText, ClipboardList, Stethoscope } from "lucide-react";
import { NewNoteDialog } from "./new-note-dialog";
import { NewOrderDialog } from "./new-order-dialog";

interface Props {
    patientId: string;
}

export function DenseModeRightPanel({ patientId }: Props) {
    const summary = useDenseModeStore((s) => s.summary);
    const setShowNewNoteDialog = useDenseModeStore((s) => s.setShowNewNoteDialog);
    const setShowNewOrderDialog = useDenseModeStore((s) => s.setShowNewOrderDialog);
    const showNewNoteDialog = useDenseModeStore((s) => s.showNewNoteDialog);
    const showNewOrderDialog = useDenseModeStore((s) => s.showNewOrderDialog);

    if (!summary) return null;

    const { active_medications, pending_labs, active_encounter } = summary;

    return (
        <div className="w-72 border-l overflow-y-auto p-3 space-y-3 bg-muted/30 shrink-0">
            {active_encounter && (
                <Card>
                    <CardHeader className="p-3 pb-1">
                        <CardTitle className="text-sm flex items-center gap-1.5">
                            <Stethoscope className="size-3.5" />
                            Active Encounter
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">{active_encounter.encounter_type}</Badge>
                            <Badge className="text-[10px]">{active_encounter.status}</Badge>
                        </div>
                        {active_encounter.ward && (
                            <p className="text-xs text-muted-foreground">
                                Ward: {active_encounter.ward} {active_encounter.bed_number && `/ Bed ${active_encounter.bed_number}`}
                            </p>
                        )}
                        {active_encounter.chief_complaint && (
                            <p className="text-xs">CC: {active_encounter.chief_complaint}</p>
                        )}
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                        <Pill className="size-3.5 text-blue-500" />
                        Active Medications ({active_medications.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                    {active_medications.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No active medications</p>
                    ) : (
                        <div className="space-y-2">
                            {active_medications.map((med) => (
                                <div key={med.id} className="text-xs border-b pb-1.5 last:border-0">
                                    <p className="font-medium">{med.name}</p>
                                    <p className="text-muted-foreground">
                                        {[med.dosage, med.frequency, med.route].filter(Boolean).join(" | ")}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                        <TestTube className="size-3.5 text-amber-500" />
                        Pending Labs ({pending_labs.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                    {pending_labs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No pending labs</p>
                    ) : (
                        <div className="space-y-1.5">
                            {pending_labs.map((lab) => (
                                <div key={lab.id} className="text-xs flex items-center justify-between">
                                    <span className="font-medium">{lab.test_name}</span>
                                    <Badge variant="outline" className="text-[10px]">{lab.status}</Badge>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1 grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowNewNoteDialog(true)}>
                        <FileText className="size-3 mr-1" />
                        New Note
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setShowNewOrderDialog(true)}>
                        <ClipboardList className="size-3 mr-1" />
                        New Order
                    </Button>
                </CardContent>
            </Card>

            <NewNoteDialog patientId={patientId} open={showNewNoteDialog} onOpenChange={setShowNewNoteDialog} />
            <NewOrderDialog patientId={patientId} open={showNewOrderDialog} onOpenChange={setShowNewOrderDialog} />
        </div>
    );
}
