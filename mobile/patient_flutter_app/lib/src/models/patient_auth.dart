/// Data models for patient app authentication.

class PatientRegisterResponse {
  const PatientRegisterResponse({
    required this.patientId,
    required this.accessToken,
    required this.patientName,
  });

  final String patientId;
  final String accessToken;
  final String patientName;

  factory PatientRegisterResponse.fromJson(Map<String, dynamic> json) {
    return PatientRegisterResponse(
      patientId: json['patient_id'] as String,
      accessToken: json['access_token'] as String,
      patientName: json['patient_name'] as String? ?? '',
    );
  }
}

class PatientLoginResponse {
  const PatientLoginResponse({
    required this.patientId,
    required this.accessToken,
    required this.patientName,
  });

  final String patientId;
  final String accessToken;
  final String patientName;

  factory PatientLoginResponse.fromJson(Map<String, dynamic> json) {
    return PatientLoginResponse(
      patientId: json['patient_id'] as String,
      accessToken: json['access_token'] as String,
      patientName: json['patient_name'] as String? ?? '',
    );
  }
}

class PatientMeetingInviteResponse {
  const PatientMeetingInviteResponse({
    required this.meetingId,
    required this.inviteUrl,
    this.expiresAt,
    this.inviteToken,
    this.shortCode,
  });

  final String meetingId;
  final String inviteUrl;
  final String? expiresAt;
  final String? inviteToken;
  final String? shortCode;

  factory PatientMeetingInviteResponse.fromJson(Map<String, dynamic> json) {
    return PatientMeetingInviteResponse(
      meetingId: json['meeting_id'] as String,
      inviteUrl: json['invite_url'] as String? ?? '',
      expiresAt: json['expires_at'] as String?,
      inviteToken: json['invite_token'] as String?,
      shortCode: json['short_code'] as String?,
    );
  }
}

class PatientMeetingPresence {
  const PatientMeetingPresence({
    required this.state,
    required this.doctorOnline,
    required this.patientOnline,
  });

  final String state;
  final bool doctorOnline;
  final bool patientOnline;

  factory PatientMeetingPresence.fromJson(Map<String, dynamic> json) {
    return PatientMeetingPresence(
      state: (json['state'] as String?) ?? 'none',
      doctorOnline: json['doctor_online'] as bool? ?? false,
      patientOnline: json['patient_online'] as bool? ?? false,
    );
  }
}

class PatientMeeting {
  const PatientMeeting({
    required this.meetingId,
    required this.dateTime,
    required this.doctorName,
    required this.status,
    this.updatedAt,
    this.patientInviteUrl,
    this.patientInviteExpiresAt,
    this.roomPresence,
  });

  final String meetingId;
  final String dateTime;
  final String doctorName;
  final String status;
  final String? updatedAt;
  final String? patientInviteUrl;
  final String? patientInviteExpiresAt;
  final PatientMeetingPresence? roomPresence;

  factory PatientMeeting.fromJson(Map<String, dynamic> json) {
    // Backend sends "id" (not "meeting_id") and "doctor" as an object.
    final doctor = json['doctor'] as Map<String, dynamic>?;
    final doctorName = doctor != null
        ? '${doctor['first_name'] ?? ''} ${doctor['last_name'] ?? ''}'.trim()
        : 'แพทย์';

    return PatientMeeting(
      meetingId: (json['id'] ?? json['meeting_id'] ?? '') as String,
      dateTime: (json['date_time'] ?? '') as String,
      doctorName: doctorName.isNotEmpty ? doctorName : 'แพทย์',
      status: (json['status'] as String?) ?? 'scheduled',
      updatedAt: json['updated_at'] as String?,
      patientInviteUrl: json['patient_invite_url'] as String?,
      patientInviteExpiresAt: json['patient_invite_expires_at'] as String?,
      roomPresence: json['room_presence'] is Map<String, dynamic>
          ? PatientMeetingPresence.fromJson(
              json['room_presence'] as Map<String, dynamic>,
            )
          : null,
    );
  }
}
