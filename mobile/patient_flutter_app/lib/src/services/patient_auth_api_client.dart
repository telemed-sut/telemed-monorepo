import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/patient_auth.dart';
import 'auth_storage.dart';

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
        headers: await _patientAppHeaders(token: token),
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
      throw const PatientAuthApiException(_networkErrorMessage);
    }
  }

  Future<PatientMeetingInviteResponse> issueMeetingInvite({
    required String token,
    required String meetingId,
  }) async {
    final normalizedMeetingId = meetingId.trim();
    final endpoint = _baseUri
        .resolve('/patient-app/me/meetings/$normalizedMeetingId/invite');
    try {
      final response = await _httpClient.post(
        endpoint,
        headers: await _patientAppHeaders(token: token),
      );
      final body = _decodeBody(response.body);
      _assertSuccess(response, body);
      return PatientMeetingInviteResponse.fromJson(
          body as Map<String, dynamic>);
    } catch (e) {
      if (e is PatientAuthApiException) rethrow;
      throw const PatientAuthApiException(_networkErrorMessage);
    }
  }

  Future<void> recordWeight({
    required String token,
    required double weightKg,
    double? heightCm,
  }) async {
    final endpoint = _baseUri.resolve('/patient-app/me/weight');
    final payload = <String, dynamic>{
      'weight_kg': weightKg,
      if (heightCm != null) 'height_cm': heightCm,
      'measured_at': DateTime.now().toUtc().toIso8601String(),
    };
    try {
      final response = await _httpClient.post(
        endpoint,
        headers: await _patientAppHeaders(
          token: token,
          jsonBody: true,
        ),
        body: jsonEncode(payload),
      );
      final body = _decodeBody(response.body);
      _assertSuccess(response, body);
    } catch (e) {
      if (e is PatientAuthApiException) rethrow;
      throw const PatientAuthApiException(_networkErrorMessage);
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
        headers: await _patientAppHeaders(jsonBody: true),
        body: jsonEncode(payload),
      );
    } catch (e) {
      throw const PatientAuthApiException(_networkErrorMessage);
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
    throw PatientAuthApiException(
      _sanitizeErrorMessage(response.statusCode, body),
      statusCode: response.statusCode,
    );
  }

  Future<Map<String, String>> _patientAppHeaders({
    String? token,
    bool jsonBody = false,
  }) async {
    final deviceId = await AuthStorage.getOrCreatePatientDeviceId();
    return {
      if (jsonBody) 'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-patient-device-id': deviceId,
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }
}

const _networkErrorMessage =
    'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง';
const _genericRequestErrorMessage =
    'ไม่สามารถดำเนินการได้ กรุณาตรวจสอบข้อมูลแล้วลองใหม่อีกครั้ง';
const _genericServerErrorMessage =
    'เซิร์ฟเวอร์ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้ง';

String _sanitizeErrorMessage(int statusCode, dynamic body) {
  final detail = _extractErrorDetail(body).toLowerCase();

  if (detail.contains('invalid phone number or pin')) {
    return 'เบอร์โทรศัพท์หรือ PIN ไม่ถูกต้อง';
  }
  if (detail.contains('invalid or expired registration code')) {
    return 'รหัสลงทะเบียนไม่ถูกต้องหรือหมดอายุแล้ว';
  }
  if (detail.contains('registration code has expired')) {
    return 'รหัสลงทะเบียนหมดอายุแล้ว กรุณาขอรหัสใหม่จากทีมดูแล';
  }
  if (detail.contains('phone number does not match')) {
    return 'เบอร์โทรศัพท์ไม่ตรงกับข้อมูลที่ลงทะเบียนไว้';
  }
  if (detail.contains('patient account not found or inactive')) {
    return 'ไม่พบบัญชีผู้ป่วยหรือบัญชีถูกปิดใช้งาน';
  }
  if (detail.contains('meeting not found')) {
    return 'ไม่พบการนัดหมายที่ต้องการ';
  }
  if (_isSessionError(detail)) {
    return 'เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่';
  }

  if (statusCode == 429) {
    return 'คุณทำรายการเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่';
  }
  if (statusCode >= 500) {
    return _genericServerErrorMessage;
  }
  if (statusCode == 400 || statusCode == 401 || statusCode == 403 || statusCode == 422) {
    return _genericRequestErrorMessage;
  }
  return _genericServerErrorMessage;
}

String _extractErrorDetail(dynamic body) {
  if (body is Map<String, dynamic>) {
    final detail = body['detail'];
    if (detail is String && detail.trim().isNotEmpty) {
      return detail.trim();
    }
    if (detail is Map<String, dynamic>) {
      final nestedMessage = detail['message'];
      if (nestedMessage is String && nestedMessage.trim().isNotEmpty) {
        return nestedMessage.trim();
      }
    }
  }
  return '';
}

bool _isSessionError(String detail) {
  return detail.contains('invalid or expired token') ||
      detail.contains('invalid token') ||
      detail.contains('not authenticated');
}
