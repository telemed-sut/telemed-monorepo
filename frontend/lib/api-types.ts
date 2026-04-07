export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user?: UserMe;
}

export interface ForgotPasswordResponse {
  message: string;
  reset_token?: string | null;
}

export interface UserInviteCreateResponse {
  invite_url: string;
  expires_at: string;
}

export type UserInviteStatus = "active" | "expired" | "closed";

export interface UserInviteItem {
  id: string;
  email: string;
  role: string;
  created_by?: string | null;
  created_at: string;
  expires_at: string;
  used_at?: string | null;
  status: UserInviteStatus;
}

export interface UserInviteListResponse {
  items: UserInviteItem[];
  total: number;
  page: number;
  limit: number;
}

export interface InviteInfoResponse {
  email: string;
  role: string;
  expires_at: string;
}

export interface UserMe {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  verification_status?: string | null;
  two_factor_enabled?: boolean;
  mfa_verified?: boolean;
  mfa_authenticated_at?: string | null;
  mfa_recent_for_privileged_actions?: boolean;
  auth_source?: string;
  sso_provider?: string | null;
}

export interface AccessProfile {
  has_privileged_access: boolean;
  access_class?: string | null;
  access_class_revealed: boolean;
  can_manage_privileged_admins: boolean;
  can_manage_security_recovery: boolean;
  can_bootstrap_privileged_roles: boolean;
}

export interface AdminSsoStatus {
  enabled: boolean;
  provider?: string | null;
  enforced_for_admin: boolean;
  login_path?: string | null;
  logout_path?: string | null;
}

export interface Admin2FAStatus {
  role?: string;
  required: boolean;
  enabled: boolean;
  setup_required: boolean;
  issuer?: string | null;
  account_email?: string | null;
  provisioning_uri?: string | null;
  trusted_device_days?: number | null;
}

export interface TrustedDevice {
  id: string;
  ip_address?: string | null;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
  current_device: boolean;
}

export interface TrustedDeviceListResponse {
  items: TrustedDevice[];
  total: number;
}

export interface BackupCodesResponse {
  codes: string[];
  generated_at: string;
  expires_at?: string | null;
}

export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PatientListResponse {
  items: Patient[];
  page: number;
  limit: number;
  total: number;
}

export interface PatientContactDetails {
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export type PatientAssignmentRole = "primary" | "consulting";

export interface AssignmentDoctorBrief {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface PatientAssignment {
  id: string;
  doctor_id: string;
  patient_id: string;
  role: PatientAssignmentRole;
  assigned_at: string;
  doctor?: AssignmentDoctorBrief | null;
}

export interface PatientAssignmentListResponse {
  items: PatientAssignment[];
  total: number;
}

export type SortOrder = "asc" | "desc";

export interface AdminSecurityUserLookup {
  user_id: string;
  email: string;
  role: string;
  two_factor_enabled: boolean;
  is_locked: boolean;
}

export interface AdminEmergencyUnlockPayload {
  email?: string;
  user_id?: string;
  reason?: string;
}

export interface AdminEmergencyUnlockResponse {
  message: string;
  user_id: string;
  email: string;
  was_locked: boolean;
}

export interface AdminPasswordResetResponse {
  message: string;
  user_id: string;
  email: string;
  reset_token: string;
  reset_token_expires_in: number;
}

export interface FetchPatientsParams {
  page?: number;
  limit?: number;
  q?: string;
  sort?: string;
  order?: SortOrder;
}

export interface HeartSoundRecord {
  id: string;
  patient_id: string;
  device_id: string;
  mac_address: string;
  position: number;
  blob_url: string;
  storage_key?: string | null;
  mime_type?: string | null;
  duration_seconds?: number | null;
  recorded_at: string;
  created_at: string;
}

export interface HeartSoundListResponse {
  items: HeartSoundRecord[];
}

export const MEETING_STATUSES = [
  "scheduled",
  "waiting",
  "in_progress",
  "overtime",
  "completed",
  "cancelled",
] as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  waiting: "Checked In",
  in_progress: "In Progress",
  overtime: "Overtime",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const MEETING_STATUS_LABELS_TH: Record<MeetingStatus, string> = {
  scheduled: "กำหนดการ",
  waiting: "เช็กอินแล้ว",
  in_progress: "กำลังตรวจ",
  overtime: "เกินเวลา",
  completed: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
};

export interface DoctorBrief {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface PatientBrief {
  id: string;
  first_name: string;
  last_name: string;
  people_id?: string | null;
}

export type MeetingRoomPresenceState =
  | "none"
  | "patient_waiting"
  | "both_in_room"
  | "doctor_only"
  | "doctor_left_patient_waiting";

export interface MeetingRoomPresence {
  meeting_id: string;
  state: MeetingRoomPresenceState;
  doctor_online: boolean;
  patient_online: boolean;
  refreshed_at?: string | null;
  doctor_joined_at?: string | null;
  doctor_last_seen_at?: string | null;
  patient_last_seen_at?: string | null;
  patient_joined_at?: string | null;
  doctor_left_at?: string | null;
  patient_left_at?: string | null;
  updated_at?: string | null;
}

export interface MeetingReliabilitySnapshot {
  meeting_id: string;
  checked_at: string;
  heartbeat_timeout_seconds: number;
  meeting_status: MeetingStatus;
  meeting_status_before_reconcile: MeetingStatus;
  meeting_status_reconciled: boolean;
  active_status_projection: MeetingStatus;
  status_in_sync?: boolean | null;
  room_presence_state: MeetingRoomPresenceState;
  doctor_online: boolean;
  patient_online: boolean;
  doctor_presence_stale: boolean;
  patient_presence_stale: boolean;
  doctor_last_seen_at?: string | null;
  patient_last_seen_at?: string | null;
  doctor_last_seen_age_seconds?: number | null;
  patient_last_seen_age_seconds?: number | null;
  doctor_left_at?: string | null;
  patient_left_at?: string | null;
  refreshed_at?: string | null;
  updated_at?: string | null;
}

export interface Meeting {
  id: string;
  date_time: string;
  description?: string | null;
  doctor_id?: string | null;
  note?: string | null;
  patient_invite_url?: string | null;
  room?: string | null;
  user_id?: string | null;
  status: MeetingStatus;
  reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  created_at?: string;
  updated_at?: string;
  doctor?: DoctorBrief | null;
  patient?: PatientBrief | null;
  room_presence?: MeetingRoomPresence | null;
}

export interface MeetingVideoTokenResponse {
  provider: "mock" | "zego";
  meeting_id: string;
  app_id?: number | null;
  room_id: string;
  user_id: string;
  token: string;
  issued_at: string;
  expires_at: string;
}

export interface MeetingPatientInviteResponse {
  meeting_id: string;
  room_id: string;
  invite_token: string;
  short_code: string;
  invite_url: string;
  issued_at: string;
  expires_at: string;
}

export interface MeetingPatientPresencePayload {
  meetingId?: string;
  inviteToken?: string;
  shortCode?: string;
}

export interface MeetingListResponse {
  items: Meeting[];
  page: number;
  limit: number;
  total: number;
}

export interface FetchMeetingsParams {
  page?: number;
  limit?: number;
  q?: string;
  doctor_id?: string;
  patient_id?: string;
  status?: MeetingStatus;
  sort?: string;
  order?: SortOrder;
}

export interface MeetingCreatePayload {
  date_time: string;
  description?: string;
  doctor_id: string;
  note?: string;
  room?: string;
  user_id: string;
  status?: MeetingStatus;
}

export interface MeetingUpdatePayload {
  date_time?: string;
  description?: string;
  doctor_id?: string;
  note?: string;
  room?: string;
  user_id?: string;
  status?: MeetingStatus;
  reason?: string;
}

export interface User {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  specialty?: string | null;
  department?: string | null;
  license_no?: string | null;
  license_expiry?: string | null;
  verification_status?: string | null;
  privileged_roles?: string[];
}

export interface UserCreate {
  email: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  is_active?: boolean;
  specialty?: string;
  department?: string;
  license_no?: string;
  license_expiry?: string;
  verification_status?: string;
}

export interface UserUpdate {
  email?: string;
  password?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  is_active?: boolean;
  specialty?: string;
  department?: string;
  license_no?: string;
  license_expiry?: string;
  verification_status?: string;
}

export interface UserListResponse {
  items: User[];
  page: number;
  limit: number;
  total: number;
}

export interface MonthlyStats {
  month: string;
  new_patients: number;
  consultations: number;
}

export interface OverviewStatsResponse {
  year: number;
  monthly: MonthlyStats[];
  totals: { patients: number; meetings: number };
  kpis: {
    today_consultations: number;
    this_week_consultations: number;
    this_month_new_patients: number;
  };
}

export interface PatientHeader {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  age: number | null;
  gender: string | null;
  allergies: string | null;
  blood_group: string | null;
  risk_score: number | null;
  primary_diagnosis: string | null;
  ward: string | null;
  bed_number: string | null;
  people_id: string | null;
}

export interface ActiveEncounter {
  id: string;
  encounter_type: string;
  status: string;
  admitted_at: string;
  ward: string | null;
  bed_number: string | null;
  chief_complaint: string | null;
}

export interface ActiveMedication {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
  status: string;
}

export interface PendingLab {
  id: string;
  test_name: string;
  category: string | null;
  status: string;
  ordered_at: string;
}

export interface ClinicalAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  message: string | null;
  created_at: string;
  is_acknowledged: boolean;
}

export interface CurrentConditionBrief {
  id: string;
  condition: string;
  severity: string | null;
}

export interface TreatmentBrief {
  id: string;
  name: string;
  is_active: boolean;
}

export interface AssignedDoctor {
  id: string;
  name: string;
  role: string | null;
}

export interface PatientDenseSummary {
  patient: PatientHeader;
  active_encounter: ActiveEncounter | null;
  active_medications: ActiveMedication[];
  pending_labs: PendingLab[];
  active_alerts: ClinicalAlert[];
  current_conditions: CurrentConditionBrief[];
  active_treatments: TreatmentBrief[];
  assigned_doctors: AssignedDoctor[];
}

export interface TimelineEvent {
  id: string;
  patient_id: string;
  event_type: string;
  event_time: string;
  title: string;
  summary: string | null;
  details: string | null;
  is_abnormal: boolean;
  author_id: string | null;
  author_name: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: string;
}

export interface TimelineResponse {
  items: TimelineEvent[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface LabTrendPoint {
  id: string;
  test_name: string;
  result_value: string;
  result_unit: string | null;
  reference_range: string | null;
  is_abnormal: boolean;
  resulted_at: string | null;
}

export interface OrderCreatePayload {
  order_type: "medication" | "lab" | "imaging";
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  category?: string;
  notes?: string;
  start_date?: string;
}

export interface NoteCreatePayload {
  note_type?: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  title?: string;
}

export interface DeviceStats {
  period_hours: number;
  success_count: number;
  error_count: number;
  error_rate: number;
  errors_by_device: { device_id: string; count: number }[];
}

export interface DeviceErrorLog {
  id: number;
  device_id: string;
  error_message: string;
  ip_address: string;
  endpoint: string;
  occurred_at: string;
  error_code?: string;
  suggestion?: string;
}

export interface FetchDeviceStatsOptions {
  topDevices?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface FetchDeviceErrorsOptions {
  limit?: number;
  hours?: number;
  since?: string;
  until?: string;
  sinceId?: number;
  deviceId?: string;
}

export interface AuditLogItem {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  action: string;
  result: "success" | "failure";
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | string | null;
  ip_address: string | null;
  is_break_glass: boolean;
  break_glass_reason: string | null;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLogItem[];
  limit: number;
  next_cursor?: string | null;
}

export interface IPBan {
  id: string;
  ip_address: string;
  reason: string | null;
  failed_attempts: number;
  banned_until: string | null;
  created_at: string;
}

export interface IPBanListResponse {
  items: IPBan[];
  total: number;
}

export interface LoginAttemptRecord {
  id: string;
  ip_address: string;
  email: string;
  success: boolean;
  details?: string | null;
  created_at: string;
}

export interface LoginAttemptListResponse {
  items: LoginAttemptRecord[];
  total: number;
}

export interface SecurityStats {
  active_ip_bans: number;
  failed_logins_24h: number;
  failed_logins_1h: number;
  locked_accounts: number;
  total_attempts_24h: number;
  forbidden_403_1h: number;
  forbidden_403_baseline_24h: number;
  forbidden_403_spike: boolean;
  purge_actions_24h: number;
  emergency_actions_24h: number;
}

export interface DeviceRegistration {
  id: string;
  device_id: string;
  display_name: string;
  notes: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeviceRegistrationListResponse {
  items: DeviceRegistration[];
  total: number;
  page: number;
  limit: number;
}

export interface DeviceRegistrationCreatePayload {
  device_id: string;
  display_name: string;
  notes?: string;
  is_active?: boolean;
  device_secret?: string;
}

export interface DeviceRegistrationCreateResponse {
  device: DeviceRegistration;
  device_secret: string;
}

export interface DeviceRegistrationUpdatePayload {
  display_name?: string;
  notes?: string;
  is_active?: boolean;
}

export interface DeviceRegistrationDeleteResponse {
  message: string;
  device_id: string;
}

export interface BulkDeletePatientsResponse {
  deleted: number;
  errors: string[];
}

export interface BulkDeleteUsersResponse {
  deleted: number;
  skipped: string[];
}

export interface BulkRestoreUsersResponse {
  restored: number;
  skipped: string[];
}

export interface PurgeDeletedUsersResponse {
  purged: number;
}

export interface PatientRegistrationCodeResponse {
  patient_id: string;
  code: string;
  expires_at: string;
}
