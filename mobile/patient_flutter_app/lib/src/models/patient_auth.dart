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

class PatientMeeting {
  const PatientMeeting({
    required this.meetingId,
    required this.dateTime,
    required this.doctorName,
    required this.status,
    this.patientInviteUrl,
  });

  final String meetingId;
  final String dateTime;
  final String doctorName;
  final String status;
  final String? patientInviteUrl;

  factory PatientMeeting.fromJson(Map<String, dynamic> json) {
    return PatientMeeting(
      meetingId: json['meeting_id'] as String,
      dateTime: json['date_time'] as String,
      doctorName: json['doctor_name'] as String? ?? 'Doctor',
      status: json['status'] as String? ?? 'scheduled',
      patientInviteUrl: json['patient_invite_url'] as String?,
    );
  }
}
