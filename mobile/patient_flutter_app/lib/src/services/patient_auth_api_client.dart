import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/patient_auth.dart';

class PatientAuthApiException implements Exception {
  const PatientAuthApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'PatientAuthApiException($statusCode): $message';
}

/// API client for patient app authentication endpoints.
class PatientAuthApiClient {
  PatientAuthApiClient({
    required String baseUrl,
    http.Client? httpClient,
  })  : _httpClient = httpClient ?? http.Client(),
        _baseUri = Uri.parse(baseUrl.trim().replaceAll(RegExp(r'/*$'), ''));

  final http.Client _httpClient;
  final Uri _baseUri;

  /// Register with phone + code → set PIN → get token.
  Future<PatientRegisterResponse> register({
    required String phone,
    required String code,
    required String pin,
  }) async {
    final endpoint = _baseUri.resolve('/patient-app/register');
    final response = await _postJson(endpoint, {
      'phone': phone.trim(),
      'code': code.trim().toUpperCase(),
      'pin': pin.trim(),
    });
    final body = _decodeBody(response.body);
    _assertSuccess(response, body);
    return PatientRegisterResponse.fromJson(body as Map<String, dynamic>);
  }

  /// Login with phone + PIN → get token.
  Future<PatientLoginResponse> login({
    required String phone,
    required String pin,
  }) async {
    final endpoint = _baseUri.resolve('/patient-app/login');
    final response = await _postJson(endpoint, {
      'phone': phone.trim(),
      'pin': pin.trim(),
    });
    final body = _decodeBody(response.body);
    _assertSuccess(response, body);
    return PatientLoginResponse.fromJson(body as Map<String, dynamic>);
  }

  /// Get my meetings (requires auth token).
  Future<List<PatientMeeting>> getMyMeetings(String token) async {
    final endpoint = _baseUri.resolve('/patient-app/me/meetings');
    try {
      final response = await _httpClient.get(
        endpoint,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );
      final body = _decodeBody(response.body);
      _assertSuccess(response, body);
      final data = body as Map<String, dynamic>;
      final items = data['items'] as List<dynamic>? ?? [];
      return items
          .map((m) => PatientMeeting.fromJson(m as Map<String, dynamic>))
          .toList();
    } catch (e) {
      if (e is PatientAuthApiException) rethrow;
      throw PatientAuthApiException('Network error: $e');
    }
  }

  Future<PatientMeetingInviteResponse> issueMeetingInvite({
    required String token,
    required String meetingId,
  }) async {
    final normalizedMeetingId = meetingId.trim();
    final endpoint = _baseUri.resolve('/patient-app/me/meetings/$normalizedMeetingId/invite');
    try {
      final response = await _httpClient.post(
        endpoint,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );
      final body = _decodeBody(response.body);
      _assertSuccess(response, body);
      return PatientMeetingInviteResponse.fromJson(body as Map<String, dynamic>);
    } catch (e) {
      if (e is PatientAuthApiException) rethrow;
      throw PatientAuthApiException('Network error: $e');
    }
  }

  void close() {
    _httpClient.close();
  }

  // ── helpers ──

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
    } catch (e) {
      throw PatientAuthApiException('Network error: $e');
    }
  }

  dynamic _decodeBody(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return body;
    }
  }

  void _assertSuccess(http.Response response, dynamic body) {
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    String detail = 'Request failed';
    if (body is Map<String, dynamic>) {
      detail = body['detail'] as String? ?? detail;
    }
    throw PatientAuthApiException(detail, statusCode: response.statusCode);
  }
}
