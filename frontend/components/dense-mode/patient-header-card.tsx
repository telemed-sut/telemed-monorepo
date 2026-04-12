"use client";

import { useDenseModeStore } from "@/store/dense-mode-store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Heart, Droplets, ShieldAlert, Thermometer } from "lucide-react";

export function PatientHeaderCard() {
    const summary = useDenseModeStore((s) => s.summary);
    if (!summary) return null;

    const { patient } = summary;

    const getAge = (dob: string) => {
        const birth = new Date(dob);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age;
    };

    const riskColor =
        (patient.risk_score ?? 0) >= 7
            ? "text-red-600 bg-red-100"
            : (patient.risk_score ?? 0) >= 4
                ? "text-amber-600 bg-amber-100"
                : "text-green-600 bg-green-100";

    const allergies = patient.allergies
        ? patient.allergies.split(",").map((a) => a.trim()).filter(Boolean)
        : [];

    const initials =
        (patient.first_name?.charAt(0) ?? "") + (patient.last_name?.charAt(0) ?? "");

    return (
        <Card className="border-b rounded-none shrink-0">
            <CardContent className="p-4">
                <div className="flex items-start gap-4">
                    <Avatar className="size-14 ring-2 ring-primary/20">
                        <AvatarFallback
                            className="font-bold text-lg"
                            seed={`${patient.id}|${patient.first_name}|${patient.last_name}|${patient.people_id}`}
                        >
                            {initials}
                        </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg font-bold">
                                {patient.first_name} {patient.last_name}
                            </h2>
                            {patient.people_id && (
                                <Badge variant="outline" className="text-xs">
                                    HN: {patient.people_id}
                                </Badge>
                            )}
                            {patient.gender && (
                                <Badge variant="secondary" className="text-xs capitalize">
                                    {patient.gender}
                                </Badge>
                            )}
                        </div>

                        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                            {patient.date_of_birth && (
                                <span>{getAge(patient.date_of_birth)} years old</span>
                            )}
                            {patient.blood_group && (
                                <span className="flex items-center gap-1">
                                    <Droplets className="size-3.5 text-red-500" />
                                    {patient.blood_group}
                                </span>
                            )}
                            {patient.risk_score != null && (
                                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${riskColor}`}>
                                    <ShieldAlert className="size-3" />
                                    Risk: {patient.risk_score}/10
                                </span>
                            )}
                        </div>

                        {patient.primary_diagnosis && (
                            <div className="flex items-center gap-1.5 text-sm">
                                <Thermometer className="size-3.5 text-blue-500" />
                                <span className="font-medium">Dx:</span>
                                <span className="text-muted-foreground">{patient.primary_diagnosis}</span>
                            </div>
                        )}

                        {allergies.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <Heart className="size-3.5 text-red-500 shrink-0" />
                                <span className="text-xs font-medium text-red-600">Allergies:</span>
                                {allergies.map((a) => (
                                    <Badge key={a} variant="destructive" className="text-[10px]">
                                        {a}
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
