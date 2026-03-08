import 'dart:async';

import 'package:flutter/material.dart';

import '../config/app_config.dart';
import '../models/patient_auth.dart';
import '../models/patient_invite_link.dart';
import '../models/patient_video_session.dart';
import '../services/patient_auth_api_client.dart';
import '../services/patient_video_api_client.dart';
import '../services/auth_storage.dart';
import 'patient_login_page.dart';
import 'patient_video_room_page.dart';

/// Displays the patient's upcoming meetings with a "เข้าห้อง" (Join) button.
class PatientMeetingsPage extends StatefulWidget {
  const PatientMeetingsPage({super.key});

  @override
  State<PatientMeetingsPage> createState() => _PatientMeetingsPageState();
}

class _PatientMeetingsPageState extends State<PatientMeetingsPage>
    with WidgetsBindingObserver {
  static const _activeMeetingPollInterval = Duration(seconds: 5);
  static const _nearMeetingPollInterval = Duration(seconds: 10);
  static const _idlePollInterval = Duration(seconds: 30);
  static const _nearMeetingWindow = Duration(minutes: 15);

  List<PatientMeeting>? _meetings;
  bool _isLoading = true;
  bool _isRefreshingMeetings = false;
  String? _errorMessage;
  String _patientName = '';
  String? _joiningMeetingId;
  Timer? _pollTimer;
  late final PatientAuthApiClient _authApiClient;

  @override
  void initState() {
    super.initState();
    _authApiClient = PatientAuthApiClient(
      baseUrl: AppConfig.telemedApiBaseUrl,
    );
    WidgetsBinding.instance.addObserver(this);
    unawaited(_initializePage());
  }

  @override
  void dispose() {
    _stopPolling();
    _authApiClient.close();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_silentRefresh());
      _resumeAdaptivePolling();
    } else if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _stopPolling();
    }
  }

  void _resumeAdaptivePolling() {
    if (!mounted) return;
    _pollTimer?.cancel();
    _scheduleNextPoll();
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  void _scheduleNextPoll() {
    if (!mounted) return;
    _pollTimer = Timer(_resolvePollInterval(), () async {
      await _silentRefresh();
      if (mounted) {
        _scheduleNextPoll();
      }
    });
  }

  Duration _resolvePollInterval() {
    final meetings = _meetings;
    if (meetings == null || meetings.isEmpty) {
      return _idlePollInterval;
    }

    final now = DateTime.now();
    if (meetings.any(_isActivelyWaitingMeeting)) {
      return _activeMeetingPollInterval;
    }
    if (meetings.any((meeting) => _isNearMeetingWindow(meeting, now))) {
      return _nearMeetingPollInterval;
    }
    return _idlePollInterval;
  }

  bool _isActivelyWaitingMeeting(PatientMeeting meeting) {
    if (!_isJoinableMeeting(meeting)) {
      return false;
    }

    final presenceState = meeting.roomPresence?.state;
    if (presenceState == 'patient_waiting' ||
        presenceState == 'doctor_left_patient_waiting' ||
        presenceState == 'doctor_only' ||
        presenceState == 'both_in_room') {
      return true;
    }

    return meeting.status == 'waiting' || meeting.status == 'in_progress';
  }

  bool _isNearMeetingWindow(PatientMeeting meeting, DateTime now) {
    if (!_isJoinableMeeting(meeting) || _isActivelyWaitingMeeting(meeting)) {
      return false;
    }

    final parsedDateTime = DateTime.tryParse(meeting.dateTime);
    if (parsedDateTime == null) {
      return false;
    }

    final scheduledTime = parsedDateTime.toLocal();
    final secondsUntilMeeting = scheduledTime.difference(now).inSeconds;
    return secondsUntilMeeting >= -_nearMeetingWindow.inSeconds &&
        secondsUntilMeeting <= _nearMeetingWindow.inSeconds;
  }

  bool _isJoinableMeeting(PatientMeeting meeting) {
    return meeting.status != 'completed' && meeting.status != 'cancelled';
  }

  Future<void> _initializePage() async {
    await _loadData();
    final token = await AuthStorage.getToken();
    if (!mounted || token == null || token.isEmpty) {
      return;
    }
    _resumeAdaptivePolling();
  }

  /// Refresh meetings in the background without showing a loading spinner.
  Future<void> _silentRefresh() async {
    if (_isRefreshingMeetings) return;

    final token = await AuthStorage.getToken();
    if (token == null || token.isEmpty) return;

    _isRefreshingMeetings = true;
    try {
      final meetings = await _authApiClient.getMyMeetings(token);
      if (!mounted) return;
      setState(() {
        _meetings = meetings;
        _errorMessage = null;
      });
    } on PatientAuthApiException catch (e) {
      if (e.statusCode == 401) {
        _stopPolling();
        await AuthStorage.clearSession();
        if (mounted) _navigateToLogin();
      }
      // Silently ignore other errors during background poll.
    } catch (_) {
      // Silently ignore — don't overwrite the UI with an error on background poll.
    } finally {
      _isRefreshingMeetings = false;
    }
  }

  Future<void> _loadData() async {
    if (_isRefreshingMeetings) return;

    final token = await AuthStorage.getToken();
    final name = await AuthStorage.getPatientName();

    if (token == null || token.isEmpty) {
      _stopPolling();
      if (mounted) _navigateToLogin();
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _patientName = name ?? '';
    });

    _isRefreshingMeetings = true;
    try {
      final meetings = await _authApiClient.getMyMeetings(token);
      if (!mounted) return;
      setState(() {
        _meetings = meetings;
        _isLoading = false;
      });
    } on PatientAuthApiException catch (e) {
      if (e.statusCode == 401) {
        _stopPolling();
        await AuthStorage.clearSession();
        if (mounted) _navigateToLogin();
        return;
      }
      if (!mounted) return;
      setState(() {
        _errorMessage = e.message;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'เกิดข้อผิดพลาด: $e';
        _isLoading = false;
      });
    } finally {
      _isRefreshingMeetings = false;
    }
  }

  void _navigateToLogin() {
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const PatientLoginPage()),
      (_) => false,
    );
  }

  Future<void> _handleLogout() async {
    await AuthStorage.clearSession();
    if (mounted) _navigateToLogin();
  }

  Future<PatientInviteLink> _resolveInviteLink(PatientMeeting meeting) async {
    final cachedInvite = PatientInviteLink.tryParse(meeting.patientInviteUrl ?? '');
    if (cachedInvite != null &&
        cachedInvite.canJoin &&
        !_isInviteExpired(meeting.patientInviteExpiresAt)) {
      return cachedInvite;
    }

    final token = await AuthStorage.getToken();
    if (token == null || token.isEmpty) {
      _stopPolling();
      await AuthStorage.clearSession();
      if (mounted) _navigateToLogin();
      throw const PatientAuthApiException('Session expired.', statusCode: 401);
    }

    final inviteResponse = await _authApiClient.issueMeetingInvite(
      token: token,
      meetingId: meeting.meetingId,
    );
    final refreshedInvite = PatientInviteLink.tryParse(inviteResponse.inviteUrl);
    if (refreshedInvite == null || !refreshedInvite.canJoin) {
      throw const PatientAuthApiException('Invite link is invalid.');
    }

    if (mounted) {
      setState(() {
        _meetings = _meetings
            ?.map(
              (item) => item.meetingId == meeting.meetingId
                  ? PatientMeeting(
                      meetingId: item.meetingId,
                      dateTime: item.dateTime,
                      doctorName: item.doctorName,
                      status: item.status,
                      updatedAt: item.updatedAt,
                      patientInviteUrl: inviteResponse.inviteUrl,
                      patientInviteExpiresAt: inviteResponse.expiresAt,
                      roomPresence: item.roomPresence,
                    )
                  : item,
            )
            .toList();
      });
    }

    return refreshedInvite;
  }

  Future<PatientInviteLink> _refreshInviteLink(PatientMeeting meeting) async {
    final token = await AuthStorage.getToken();
    if (token == null || token.isEmpty) {
      _stopPolling();
      await AuthStorage.clearSession();
      if (mounted) _navigateToLogin();
      throw const PatientAuthApiException('Session expired.', statusCode: 401);
    }

    final inviteResponse = await _authApiClient.issueMeetingInvite(
      token: token,
      meetingId: meeting.meetingId,
    );
    final refreshedInvite = PatientInviteLink.tryParse(inviteResponse.inviteUrl);
    if (refreshedInvite == null || !refreshedInvite.canJoin) {
      throw const PatientAuthApiException('Invite link is invalid.');
    }

    if (mounted) {
      setState(() {
        _meetings = _meetings
            ?.map(
              (item) => item.meetingId == meeting.meetingId
                  ? PatientMeeting(
                      meetingId: item.meetingId,
                      dateTime: item.dateTime,
                      doctorName: item.doctorName,
                      status: item.status,
                      updatedAt: item.updatedAt,
                      patientInviteUrl: inviteResponse.inviteUrl,
                      patientInviteExpiresAt: inviteResponse.expiresAt,
                      roomPresence: item.roomPresence,
                    )
                  : item,
            )
            .toList();
      });
    }

    return refreshedInvite;
  }

  bool _isInviteExpired(String? expiresAt) {
    if (expiresAt == null || expiresAt.isEmpty) {
      return false;
    }

    final parsedExpiry = DateTime.tryParse(expiresAt);
    if (parsedExpiry == null) {
      return false;
    }

    return !parsedExpiry.toLocal().isAfter(DateTime.now());
  }

  Future<void> _handleJoinMeeting(PatientMeeting meeting) async {
    setState(() => _joiningMeetingId = meeting.meetingId);
    _stopPolling();
    final apiClient = PatientVideoApiClient(
      baseUrl: AppConfig.telemedApiBaseUrl,
    );

    try {
      var invite = await _resolveInviteLink(meeting);
      PatientVideoSession? session;

      try {
        session = await apiClient.issuePatientVideoToken(
          meetingId: invite.meetingId,
          inviteToken: invite.inviteToken,
          shortCode: invite.shortCode,
        );
      } on PatientVideoApiException catch (e) {
        if (e.statusCode == 401 || e.statusCode == 403) {
          invite = await _refreshInviteLink(meeting);
          session = await apiClient.issuePatientVideoToken(
            meetingId: invite.meetingId,
            inviteToken: invite.inviteToken,
            shortCode: invite.shortCode,
          );
        } else {
          rethrow;
        }
      }

      if (!mounted) return;
      if (session == null) {
        _showSnackBar('ไม่สามารถเข้าห้องได้ กรุณาลองใหม่');
        return;
      }
      if (session.provider != 'zego') {
        _showSnackBar('ระบบวิดีโอไม่รองรับ');
        return;
      }

      final patientName = _patientName.isNotEmpty ? _patientName : 'คนไข้';

      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PatientVideoRoomPage(
            session: session,
            displayName: patientName,
            startWithCamera: true,
            startWithMicrophone: true,
            inviteToken: invite.inviteToken,
            shortCode: invite.shortCode,
          ),
        ),
      );
    } on PatientVideoApiException catch (e) {
      if (mounted) _showSnackBar(e.message);
    } catch (_) {
      if (mounted) _showSnackBar('ไม่สามารถเข้าห้องได้ กรุณาลองใหม่');
    } finally {
      apiClient.close();
      if (mounted) {
        setState(() => _joiningMeetingId = null);
        await _silentRefresh();
        _resumeAdaptivePolling();
      }
    }
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFF6F9FF), Color(0xFFF2F6FD), Color(0xFFEFF4FB)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
                child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xF8FFFFFF),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: const Color(0xFFD8E4F5)),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x0D0F172A),
                        blurRadius: 16,
                        offset: Offset(0, 8),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'นัดหมายของฉัน',
                              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 20),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              _patientName.isNotEmpty
                                  ? _patientName
                                  : 'ตรวจสอบนัดหมายและเข้าห้องจากรายการด้านล่าง',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: const Color(0xFF475569),
                                fontWeight: _patientName.isNotEmpty
                                    ? FontWeight.w600
                                    : FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        onPressed: _isLoading ? null : _loadData,
                        tooltip: 'รีเฟรช',
                        style: IconButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(0xFF1E3A8A),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                            side: const BorderSide(color: Color(0xFFD5E1F2)),
                          ),
                        ),
                        icon: const Icon(Icons.refresh_rounded),
                      ),
                      const SizedBox(width: 8),
                      PopupMenuButton<String>(
                        tooltip: 'ตัวเลือก',
                        onSelected: (value) {
                          if (value == 'logout') _handleLogout();
                        },
                        itemBuilder: (_) => [
                          const PopupMenuItem(
                            value: 'logout',
                            child: Row(
                              children: [
                                Icon(Icons.logout, size: 20),
                                SizedBox(width: 8),
                                Text('ออกจากระบบ'),
                              ],
                            ),
                          ),
                        ],
                        child: Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFFD5E1F2)),
                          ),
                          child: const Icon(Icons.more_horiz_rounded, color: Color(0xFF1E3A8A)),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Expanded(child: _buildBody(theme)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline,
                  size: 48, color: theme.colorScheme.error),
              const SizedBox(height: 16),
              Text(
                _errorMessage!,
                style: TextStyle(color: theme.colorScheme.error),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _loadData,
                icon: const Icon(Icons.refresh),
                label: const Text('ลองใหม่'),
              ),
            ],
          ),
        ),
      );
    }

    final meetings = _meetings ?? [];
    if (meetings.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.calendar_today,
                  size: 48,
                  color: theme.colorScheme.primary.withValues(alpha: 0.4)),
              const SizedBox(height: 16),
              Text(
                'ยังไม่มีนัดหมาย',
                style: theme.textTheme.titleMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'เมื่อแพทย์สร้างนัดหมายให้ จะแสดงที่นี่',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    final waitingCount =
        meetings.where((meeting) => _isPatientWaitingLive(meeting)).length;
    final activeCount =
        meetings.where((meeting) => _isPatientReadyToJoin(meeting)).length;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        itemCount: meetings.length + 1,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          if (index == 0) {
            return _MeetingsSummaryCard(
              totalCount: meetings.length,
              activeCount: activeCount,
              waitingCount: waitingCount,
            );
          }
          final meeting = meetings[index - 1];
          return _MeetingCard(
            meeting: meeting,
            isJoining: _joiningMeetingId == meeting.meetingId,
            onJoin: () => _handleJoinMeeting(meeting),
          );
        },
      ),
    );
  }
}

bool _isPatientReadyToJoin(PatientMeeting meeting) {
  if (meeting.status == 'completed' || meeting.status == 'cancelled') {
    return false;
  }

  final presence = meeting.roomPresence;
  if (presence == null) {
    return meeting.status == 'scheduled' ||
        meeting.status == 'waiting' ||
        meeting.status == 'in_progress';
  }

  return meeting.status == 'scheduled' ||
      meeting.status == 'in_progress' ||
      presence.state == 'patient_waiting' ||
      presence.state == 'doctor_left_patient_waiting' ||
      presence.state == 'doctor_only' ||
      presence.state == 'both_in_room';
}

bool _isPatientWaitingLive(PatientMeeting meeting) {
  final presence = meeting.roomPresence;
  if (presence == null) return meeting.status == 'waiting';
  return presence.state == 'patient_waiting' ||
      presence.state == 'doctor_left_patient_waiting';
}

String _patientStatusLabel(PatientMeeting meeting) {
  if (meeting.status == 'completed') return 'เสร็จสิ้น';
  if (meeting.status == 'cancelled') return 'ยกเลิก';

  final presence = meeting.roomPresence;
  if (presence?.state == 'both_in_room') return 'แพทย์อยู่ในห้อง';
  if (presence?.state == 'doctor_only') return 'แพทย์กำลังรอ';
  if (presence?.state == 'patient_waiting') return 'คุณกำลังรอแพทย์';
  if (presence?.state == 'doctor_left_patient_waiting') {
    return 'แพทย์ออกจากห้องชั่วคราว';
  }

  return switch (meeting.status) {
    'scheduled' => 'นัดหมาย',
    'waiting' => 'ห้องพร้อมแล้ว',
    'in_progress' => 'กำลังดำเนินการ',
    'completed' => 'เสร็จสิ้น',
    'cancelled' => 'ยกเลิก',
    _ => meeting.status,
  };
}

Color _patientStatusColor(PatientMeeting meeting) {
  if (meeting.status == 'completed') return const Color(0xFF6B7280);
  if (meeting.status == 'cancelled') return const Color(0xFFDC2626);

  final presence = meeting.roomPresence;
  if (presence?.state == 'both_in_room') return const Color(0xFF16A34A);
  if (presence?.state == 'doctor_only') return const Color(0xFF0F766E);
  if (presence?.state == 'patient_waiting') return const Color(0xFFD97706);
  if (presence?.state == 'doctor_left_patient_waiting') {
    return const Color(0xFFEA580C);
  }

  return switch (meeting.status) {
    'scheduled' => const Color(0xFF2563EB),
    'waiting' => const Color(0xFFD97706),
    'in_progress' => const Color(0xFF16A34A),
    'completed' => const Color(0xFF6B7280),
    'cancelled' => const Color(0xFFDC2626),
    _ => const Color(0xFF6B7280),
  };
}

String _patientActionLabel(PatientMeeting meeting, bool isJoining) {
  if (isJoining) return 'กำลังเข้า...';
  if (meeting.status == 'completed') return 'เสร็จสิ้น';
  if (meeting.status == 'cancelled') return 'ยกเลิก';

  final presence = meeting.roomPresence;
  if (presence?.state == 'both_in_room') return 'เข้าพบแพทย์';
  if (presence?.state == 'doctor_only') return 'เข้าหาแพทย์';
  if (presence?.state == 'patient_waiting') return 'กลับเข้าห้องรอ';
  if (presence?.state == 'doctor_left_patient_waiting') {
    return 'กลับเข้าห้องอีกครั้ง';
  }

  return switch (meeting.status) {
    'waiting' => 'เข้าร่วมห้อง',
    'in_progress' => 'เข้าพบแพทย์',
    _ => 'เข้าห้อง',
  };
}

String? _patientWaitingHint(PatientMeeting meeting) {
  if (meeting.status == 'completed' || meeting.status == 'cancelled') {
    return null;
  }

  final presence = meeting.roomPresence;
  if (presence?.state == 'both_in_room') {
    return 'แพทย์อยู่ในห้องแล้ว สามารถเข้าร่วมได้ทันที';
  }
  if (presence?.state == 'doctor_only') {
    return 'แพทย์กำลังรออยู่ในห้อง สามารถเข้าร่วมได้ทันที';
  }
  if (presence?.state == 'patient_waiting') {
    return 'คุณอยู่ในห้องรอแล้ว สามารถกลับเข้าร่วมได้ทันที';
  }
  if (presence?.state == 'doctor_left_patient_waiting') {
    return 'แพทย์ออกจากห้องชั่วคราว คุณยังสามารถกลับเข้าห้องและรอแพทย์ได้';
  }
  if (meeting.status == 'waiting') {
    return 'ห้องพร้อมแล้ว สามารถกดเข้าร่วมได้ทันที';
  }
  return null;
}

class _MeetingsSummaryCard extends StatelessWidget {
  const _MeetingsSummaryCard({
    required this.totalCount,
    required this.activeCount,
    required this.waitingCount,
  });

  final int totalCount;
  final int activeCount;
  final int waitingCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: const LinearGradient(
          colors: [Color(0xFFE8F0FF), Color(0xFFF4F7FF), Color(0xFFF9FBFF)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
        border: Border.all(color: const Color(0xFFD2E0F7)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x100F172A),
            blurRadius: 14,
            offset: Offset(0, 6),
          ),
        ],
      ),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Row(
        children: [
          _SummaryPill(
            icon: Icons.calendar_today_outlined,
            label: 'นัดทั้งหมด',
            value: '$totalCount',
            color: const Color(0xFF2563EB),
          ),
          const SizedBox(width: 10),
          _SummaryPill(
            icon: Icons.event_available_outlined,
            label: 'นัดที่เข้าร่วมได้',
            value: '$activeCount',
            color: const Color(0xFF16A34A),
          ),
          const SizedBox(width: 10),
          _SummaryPill(
            icon: Icons.access_time_rounded,
            label: 'รอสถานะห้อง',
            value: '$waitingCount',
            color: const Color(0xFFD97706),
          ),
          const Spacer(),
          Icon(Icons.touch_app_rounded, size: 18, color: theme.colorScheme.primary),
        ],
      ),
    );
  }
}

class _SummaryPill extends StatelessWidget {
  const _SummaryPill({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 13, color: color),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10,
                      color: color.withValues(alpha: 0.9),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: TextStyle(
                color: color,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MeetingCard extends StatelessWidget {
  const _MeetingCard({
    required this.meeting,
    required this.isJoining,
    required this.onJoin,
  });

  final PatientMeeting meeting;
  final bool isJoining;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasInvite =
        meeting.patientInviteUrl != null && meeting.patientInviteUrl!.isNotEmpty;
    final isJoinable = _isPatientReadyToJoin(meeting);
    final canJoin = hasInvite && isJoinable;

    // Parse date
    String formattedDate;
    try {
      final dt = DateTime.parse(meeting.dateTime).toLocal();
      formattedDate =
          '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')} น.';
    } catch (_) {
      formattedDate = meeting.dateTime;
    }

    final statusColor = _patientStatusColor(meeting);
    final statusLabel = _patientStatusLabel(meeting);
    final actionLabel =
        canJoin ? _patientActionLabel(meeting, isJoining) : (!hasInvite ? 'กำลังเตรียมห้อง' : statusLabel);
    final waitingHint = _patientWaitingHint(meeting);

    return Card(
      clipBehavior: Clip.antiAlias,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: Color(0xFFD9E4F4)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Doctor + status row
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor:
                      theme.colorScheme.primary.withValues(alpha: 0.1),
                  child: Icon(Icons.medical_services_outlined,
                      color: theme.colorScheme.primary, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        meeting.doctorName,
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(Icons.schedule,
                              size: 14,
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.5)),
                          const SizedBox(width: 4),
                          Text(
                            formattedDate,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.6),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(
                      color: statusColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 14),

            if (waitingHint != null) ...[
              Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF7ED),
                  border: Border.all(color: const Color(0xFFFED7AA)),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.access_time_rounded,
                        size: 16, color: Color(0xFFD97706)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        waitingHint,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: const Color(0xFF9A3412),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],

            // Join button
            SizedBox(
              width: double.infinity,
              height: 44,
              child: FilledButton.icon(
                onPressed: canJoin && !isJoining ? onJoin : null,
                icon: isJoining
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.videocam_rounded, size: 20),
                label:
                    Text(actionLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
                style: FilledButton.styleFrom(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  backgroundColor:
                      canJoin ? theme.colorScheme.primary : null,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
