import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/patient_video_session.dart';

class PatientVideoApiException implements Exception {
  const PatientVideoApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'PatientVideoApiException($statusCode): $message';
}

class PatientVideoApiClient {
  PatientVideoApiClient({
    required String baseUrl,
    http.Client? httpClient,
  })  : _httpClient = httpClient ?? http.Client(),
        _baseUri = Uri.parse(baseUrl.trim().replaceAll(RegExp(r'/*$'), ''));

  final http.Client _httpClient;
  final Uri _baseUri;

  Future<PatientVideoSession> issuePatientVideoToken({
    String? meetingId,
    String? inviteToken,
    String? shortCode,
    int? expiresInSeconds,
  }) async {
    final endpoint = _baseUri.resolve('/meetings/video/patient/token');
    final payload = <String, dynamic>{};
    if (meetingId != null && meetingId.trim().isNotEmpty) {
      payload['meeting_id'] = meetingId.trim();
    }
    if (inviteToken != null && inviteToken.trim().isNotEmpty) {
      payload['invite_token'] = inviteToken.trim();
    }
    if (shortCode != null && shortCode.trim().isNotEmpty) {
      payload['short_code'] = shortCode.trim();
    }
    if (!payload.containsKey('invite_token') &&
        !payload.containsKey('short_code')) {
      throw const PatientVideoApiException(
        'Missing invite token or short code.',
      );
    }
    if (expiresInSeconds != null) {
      payload['expires_in_seconds'] = expiresInSeconds;
    }

    final response = await _postJson(endpoint, payload);

    final decoded = _decodeBody(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final detailMessage = _extractDetail(decoded) ?? response.body;
      throw PatientVideoApiException(
        detailMessage.isEmpty
            ? 'Failed to issue patient video token.'
            : detailMessage,
        statusCode: response.statusCode,
      );
    }
    if (decoded is! Map<String, dynamic>) {
      throw const PatientVideoApiException('Unexpected API response format.');
    }

    return PatientVideoSession.fromJson(decoded);
  }

  Future<void> sendPatientPresenceHeartbeat({
    String? meetingId,
    String? inviteToken,
    String? shortCode,
  }) async {
    await _sendPatientPresence(
      endpointPath: '/meetings/video/patient/presence/heartbeat',
      meetingId: meetingId,
      inviteToken: inviteToken,
      shortCode: shortCode,
    );
  }

  Future<void> sendPatientPresenceLeave({
    String? meetingId,
    String? inviteToken,
    String? shortCode,
  }) async {
    await _sendPatientPresence(
      endpointPath: '/meetings/video/patient/presence/leave',
      meetingId: meetingId,
      inviteToken: inviteToken,
      shortCode: shortCode,
    );
  }

  Future<void> _sendPatientPresence({
    required String endpointPath,
    String? meetingId,
    String? inviteToken,
    String? shortCode,
  }) async {
    final endpoint = _baseUri.resolve(endpointPath);
    final payload = <String, dynamic>{};
    if (meetingId != null && meetingId.trim().isNotEmpty) {
      payload['meeting_id'] = meetingId.trim();
    }
    if (inviteToken != null && inviteToken.trim().isNotEmpty) {
      payload['invite_token'] = inviteToken.trim();
    }
    if (shortCode != null && shortCode.trim().isNotEmpty) {
      payload['short_code'] = shortCode.trim();
    }
    if (!payload.containsKey('invite_token') &&
        !payload.containsKey('short_code')) {
      throw const PatientVideoApiException(
        'Missing invite token or short code for presence update.',
      );
    }

    final response = await _postJson(endpoint, payload);
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    final decoded = _decodeBody(response.body);
    final detailMessage = _extractDetail(decoded) ?? response.body;
    throw PatientVideoApiException(
      detailMessage.isEmpty ? 'Failed to update room presence.' : detailMessage,
      statusCode: response.statusCode,
    );
  }

  void close() {
    _httpClient.close();
  }

  Future<http.Response> _postJson(
      Uri endpoint, Map<String, dynamic> payload) async {
    try {
      return await _httpClient.post(
        endpoint,
        headers: const {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode(payload),
      );
    } catch (error) {
      final raw = error.toString();
      final normalized = raw.replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
      throw PatientVideoApiException(
        normalized.isEmpty
            ? 'Network error while contacting backend at $endpoint'
            : 'Network error while contacting backend at $endpoint: $normalized',
      );
    }
  }

  dynamic _decodeBody(String body) {
    if (body.trim().isEmpty) return null;
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  String? _extractDetail(dynamic decoded) {
    if (decoded == null) return null;
    if (decoded is String && decoded.trim().isNotEmpty) return decoded.trim();
    if (decoded is Map<String, dynamic>) {
      final detail = decoded['detail'];
      if (detail is String && detail.trim().isNotEmpty) return detail.trim();
      if (detail is List) {
        final parts = detail.whereType<Map<String, dynamic>>().map((item) {
          final msg = item['msg'];
          return msg is String ? msg.trim() : '';
        }).where((text) => text.isNotEmpty);
        if (parts.isNotEmpty) return parts.join(' | ');
      }
    }
    return null;
  }
}
