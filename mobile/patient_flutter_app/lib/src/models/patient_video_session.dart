class PatientVideoSession {
  const PatientVideoSession({
    required this.provider,
    required this.roomId,
    required this.userId,
    required this.token,
    required this.issuedAt,
    required this.expiresAt,
    this.appId,
  });

  final String provider;
  final int? appId;
  final String roomId;
  final String userId;
  final String token;
  final DateTime issuedAt;
  final DateTime expiresAt;

  factory PatientVideoSession.fromJson(Map<String, dynamic> json) {
    final provider = (json['provider'] ?? '').toString();
    final appId = json['app_id'] is int
        ? json['app_id'] as int
        : int.tryParse((json['app_id'] ?? '').toString());
    final roomId = (json['room_id'] ?? '').toString();
    final userId = (json['user_id'] ?? '').toString();
    final token = (json['token'] ?? '').toString();
    final issuedAtRaw = (json['issued_at'] ?? '').toString();
    final expiresAtRaw = (json['expires_at'] ?? '').toString();

    if (provider.isEmpty ||
        roomId.isEmpty ||
        userId.isEmpty ||
        token.isEmpty ||
        issuedAtRaw.isEmpty ||
        expiresAtRaw.isEmpty) {
      throw const FormatException('Invalid video session payload.');
    }

    final issuedAt = DateTime.tryParse(issuedAtRaw);
    final expiresAt = DateTime.tryParse(expiresAtRaw);
    if (issuedAt == null || expiresAt == null) {
      throw const FormatException('Invalid video session timestamps.');
    }

    return PatientVideoSession(
      provider: provider,
      appId: appId,
      roomId: roomId,
      userId: userId,
      token: token,
      issuedAt: issuedAt,
      expiresAt: expiresAt,
    );
  }
}
