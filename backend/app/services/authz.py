from app.models.enums import UserRole

SUPPORTED_PRIMARY_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
})
ASSIGNABLE_CARE_TEAM_ROLES = frozenset({
    UserRole.doctor,
    UserRole.medical_student,
})
CLINICAL_VIEW_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
})
CLINICAL_WRITE_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
})
INVITABLE_ROLES = frozenset({
    UserRole.admin,
    UserRole.doctor,
    UserRole.medical_student,
})


def can_manage_users(role: UserRole | None) -> bool:
    return role == UserRole.admin


def can_view_clinical_data(role: UserRole | None) -> bool:
    return role in CLINICAL_VIEW_ROLES


def can_write_clinical_data(role: UserRole | None) -> bool:
    return role in CLINICAL_WRITE_ROLES


def can_receive_patient_assignments(role: UserRole | None) -> bool:
    return role in ASSIGNABLE_CARE_TEAM_ROLES


def can_receive_user_invite(role: UserRole | None) -> bool:
    return role in INVITABLE_ROLES


def is_medical_student_role(role: UserRole | None) -> bool:
    return role == UserRole.medical_student
