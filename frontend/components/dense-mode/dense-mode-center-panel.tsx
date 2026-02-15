"use client";

import { PatientHeaderCard } from "./patient-header-card";
import { ClinicalTimeline } from "./clinical-timeline";

interface Props {
    patientId: string;
}

export function DenseModeCenterPanel({ patientId }: Props) {
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <PatientHeaderCard />
            <ClinicalTimeline patientId={patientId} />
        </div>
    );
}
