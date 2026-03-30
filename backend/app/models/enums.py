import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    doctor = "doctor"
    medical_student = "medical_student"


class PrivilegedRole(str, enum.Enum):
    platform_super_admin = "platform_super_admin"
    security_admin = "security_admin"
    hospital_admin = "hospital_admin"


class VerificationStatus(str, enum.Enum):
    unverified = "unverified"
    pending = "pending"
    verified = "verified"


class EncounterStatus(str, enum.Enum):
    active = "active"
    discharged = "discharged"
    transferred = "transferred"


class EncounterType(str, enum.Enum):
    inpatient = "inpatient"
    outpatient = "outpatient"
    emergency = "emergency"


class OrderType(str, enum.Enum):
    medication = "medication"
    lab = "lab"
    imaging = "imaging"


class OrderStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class AlertSeverity(str, enum.Enum):
    critical = "critical"
    warning = "warning"
    info = "info"


class AlertCategory(str, enum.Enum):
    lab_result = "lab_result"
    vital_sign = "vital_sign"
    medication = "medication"
    allergy = "allergy"
    system = "system"


class TimelineEventType(str, enum.Enum):
    note = "note"
    vitals = "vitals"
    lab_result = "lab_result"
    imaging = "imaging"
    medication = "medication"
    procedure = "procedure"
    encounter = "encounter"
    order = "order"
    alert = "alert"


class NoteType(str, enum.Enum):
    progress = "progress"
    soap = "soap"
    admission = "admission"
    discharge = "discharge"


class MeetingStatus(str, enum.Enum):
    scheduled = "scheduled"
    waiting = "waiting"
    in_progress = "in_progress"
    overtime = "overtime"
    completed = "completed"
    cancelled = "cancelled"
