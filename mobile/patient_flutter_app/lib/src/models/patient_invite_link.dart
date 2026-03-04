import 'dart:convert';

final RegExp _shortCodePattern = RegExp(r'^[A-Za-z0-9]{6,24}$');

class PatientInviteLink {
  const PatientInviteLink({
    required this.meetingIdFromQuery,
    required this.meetingIdFromToken,
    required this.inviteToken,
    required this.shortCode,
  });

  final String? meetingIdFromQuery;
  final String? meetingIdFromToken;
  final String? inviteToken;
  final String? shortCode;

  String? get meetingId => meetingIdFromToken ?? meetingIdFromQuery;
  bool get hasInviteToken => (inviteToken ?? '').trim().isNotEmpty;
  bool get hasShortCode => (shortCode ?? '').trim().isNotEmpty;
  bool get canJoin => hasInviteToken || hasShortCode;

  bool get hasMeetingIdMismatch {
    if (meetingIdFromQuery == null || meetingIdFromToken == null) return false;
    return _normalizeMeetingId(meetingIdFromQuery!) != _normalizeMeetingId(meetingIdFromToken!);
  }

  static PatientInviteLink? tryParse(String rawUrl) {
    final trimmed = rawUrl.trim();
    if (trimmed.isEmpty) return null;
    if (_shortCodePattern.hasMatch(trimmed)) {
      return PatientInviteLink(
        meetingIdFromQuery: null,
        meetingIdFromToken: null,
        inviteToken: null,
        shortCode: trimmed.toLowerCase(),
      );
    }
    if (trimmed.startsWith('pjoin.')) {
      return PatientInviteLink(
        meetingIdFromQuery: null,
        meetingIdFromToken: _extractMeetingIdFromInviteToken(trimmed),
        inviteToken: trimmed,
        shortCode: null,
      );
    }

    final uri = Uri.tryParse(trimmed);
    if (uri == null) return null;

    final meetingIdFromQueryRaw = (uri.queryParameters['meeting_id'] ?? '').trim();
    final meetingIdFromQuery = meetingIdFromQueryRaw.isEmpty ? null : meetingIdFromQueryRaw;
    final inviteTokenRaw =
        ((uri.queryParameters['invite_token'] ?? uri.queryParameters['t']) ?? '').trim();
    final inviteToken = inviteTokenRaw.isEmpty ? null : inviteTokenRaw;

    final shortCodeFromQueryRaw =
        ((uri.queryParameters['short_code'] ?? uri.queryParameters['c']) ?? '').trim();
    String? shortCode = shortCodeFromQueryRaw.isEmpty ? null : shortCodeFromQueryRaw.toLowerCase();

    if (shortCode == null && uri.pathSegments.length >= 2) {
      if (uri.pathSegments[0].toLowerCase() == 'p') {
        final candidate = uri.pathSegments[1].trim();
        if (candidate.isNotEmpty) {
          shortCode = candidate.toLowerCase();
        }
      }
    }

    if (inviteToken == null && shortCode == null) {
      return null;
    }

    final meetingIdFromToken =
        inviteToken == null ? null : _extractMeetingIdFromInviteToken(inviteToken);

    return PatientInviteLink(
      meetingIdFromQuery: meetingIdFromQuery,
      meetingIdFromToken: meetingIdFromToken,
      inviteToken: inviteToken,
      shortCode: shortCode,
    );
  }

  static String _normalizeMeetingId(String value) {
    final trimmed = value.trim().toLowerCase();
    if (trimmed.isEmpty) return trimmed;
    return trimmed.replaceAll(RegExp(r'[^a-f0-9]'), '');
  }

  static String? _extractMeetingIdFromInviteToken(String inviteToken) {
    final token = inviteToken.trim();
    if (!token.startsWith('pjoin.')) return null;
    final parts = token.split('.');
    if (parts.length != 3) return null;

    final decodedPayload = _decodeBase64Url(parts[1]);
    if (decodedPayload == null || decodedPayload.isEmpty) return null;

    if (decodedPayload.startsWith('{')) {
      try {
        final parsed = jsonDecode(decodedPayload);
        if (parsed is Map<String, dynamic>) {
          final rawMeetingId = (parsed['mid'] ?? '').toString().trim();
          if (rawMeetingId.isNotEmpty) return rawMeetingId;
        }
      } catch (_) {
        return null;
      }
      return null;
    }

    if (decodedPayload.startsWith('v2:')) {
      final segments = decodedPayload.split(':');
      if (segments.length >= 4) {
        final rawMeetingId = segments[1].trim();
        if (rawMeetingId.isNotEmpty) return rawMeetingId;
      }
    }
    return null;
  }

  static String? _decodeBase64Url(String rawPayload) {
    try {
      final normalized = rawPayload.replaceAll('-', '+').replaceAll('_', '/');
      final paddingLength = (4 - normalized.length % 4) % 4;
      final withPadding = normalized + ('=' * paddingLength);
      return utf8.decode(base64Decode(withPadding));
    } catch (_) {
      return null;
    }
  }
}
