import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:zego_uikit_prebuilt_video_conference/zego_uikit_prebuilt_video_conference.dart';

import '../config/app_config.dart';
import '../models/patient_video_session.dart';
import '../services/patient_video_api_client.dart';

enum _CallHealthState {
  healthy,
  degraded,
  reconnecting,
  rejoinRequired,
}

class _CallHealthPresentation {
  const _CallHealthPresentation({
    required this.title,
    required this.message,
    required this.icon,
    required this.backgroundColor,
    required this.borderColor,
    required this.foregroundColor,
    required this.buttonLabel,
    required this.showSpinner,
  });

  final String title;
  final String message;
  final IconData icon;
  final Color backgroundColor;
  final Color borderColor;
  final Color foregroundColor;
  final String buttonLabel;
  final bool showSpinner;
}

class _CallReliabilityEvent {
  const _CallReliabilityEvent({
    required this.at,
    required this.message,
    required this.isCritical,
  });

  final String at;
  final String message;
  final bool isCritical;
}

class PatientVideoRoomPage extends StatefulWidget {
  const PatientVideoRoomPage({
    super.key,
    required this.session,
    required this.displayName,
    required this.startWithCamera,
    required this.startWithMicrophone,
    required this.inviteToken,
    required this.shortCode,
  });

  final PatientVideoSession session;
  final String displayName;
  final bool startWithCamera;
  final bool startWithMicrophone;
  final String? inviteToken;
  final String? shortCode;

  @override
  State<PatientVideoRoomPage> createState() => _PatientVideoRoomPageState();
}

class _PatientVideoRoomPageState extends State<PatientVideoRoomPage>
    with WidgetsBindingObserver {
  static const _presenceHeartbeatInterval = Duration(seconds: 10);
  static const _heartbeatDegradedThreshold = 1;
  static const _heartbeatReconnectingThreshold = 3;
  static const _heartbeatRejoinThreshold = 6;

  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;
  Timer? _presenceTimer;
  bool _leaveSent = false;
  late final PatientVideoApiClient _videoApiClient;
  late PatientVideoSession _activeSession;
  _CallHealthState _callHealthState = _CallHealthState.healthy;
  String? _callHealthMessage;
  int _heartbeatFailureCount = 0;
  int _conferenceEpoch = 0;
  bool _isManualRejoinInFlight = false;
  bool _showCallEvents = false;
  final List<_CallReliabilityEvent> _callEvents = [];

  String _currentClockLabel() {
    final now = DateTime.now();
    final hour = now.hour.toString().padLeft(2, '0');
    final minute = now.minute.toString().padLeft(2, '0');
    final second = now.second.toString().padLeft(2, '0');
    return '$hour:$minute:$second';
  }

  @override
  void initState() {
    super.initState();
    _videoApiClient =
        PatientVideoApiClient(baseUrl: AppConfig.telemedApiBaseUrl);
    _activeSession = widget.session;
    _callEvents.add(
      _CallReliabilityEvent(
        at: _currentClockLabel(),
        message: 'เข้าห้องคอลแล้ว กำลังติดตามสถานะเครือข่าย',
        isCritical: false,
      ),
    );
    WidgetsBinding.instance.addObserver(this);
    _enableImmersiveMode();
    _startPresenceHeartbeat();
  }

  @override
  void dispose() {
    _stopPresenceHeartbeat();
    // Dispose cannot await network I/O, so leaving room is best-effort here.
    _sendPresenceLeave();
    _videoApiClient.close();
    _restoreSystemUiMode();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    setState(() {
      _lifecycleState = state;
    });
    if (state == AppLifecycleState.resumed) {
      _enableImmersiveMode();
      _appendCallEvent('กลับเข้าสู่หน้าคอลแล้ว กำลังเช็กการเชื่อมต่อ');
      _setCallHealthState(
        _CallHealthState.degraded,
        message: 'กลับเข้าสู่คอลแล้ว ระบบกำลังเช็กการเชื่อมต่ออีกครั้ง',
      );
      _startPresenceHeartbeat();
    } else if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _stopPresenceHeartbeat();
      _appendCallEvent('แอปอยู่เบื้องหลัง อาจต้องเชื่อมต่อใหม่เมื่อกลับมา');
      _setCallHealthState(
        _CallHealthState.degraded,
        message: 'แอปอยู่เบื้องหลัง อาจต้องเช็กการเชื่อมต่อใหม่เมื่อกลับมา',
      );
      _sendPresenceLeave();
    }
  }

  void _startPresenceHeartbeat() {
    _presenceTimer?.cancel();
    _leaveSent = false;
    _sendPresenceHeartbeat();
    _presenceTimer = Timer.periodic(_presenceHeartbeatInterval, (_) {
      _sendPresenceHeartbeat();
    });
  }

  void _stopPresenceHeartbeat() {
    _presenceTimer?.cancel();
    _presenceTimer = null;
  }

  Future<void> _sendPresenceHeartbeat() async {
    if ((widget.inviteToken ?? '').trim().isEmpty &&
        (widget.shortCode ?? '').trim().isEmpty) {
      return;
    }
    try {
      await _videoApiClient.sendPatientPresenceHeartbeat(
        meetingId: _activeSession.meetingId,
        inviteToken: widget.inviteToken,
        shortCode: widget.shortCode,
      );
      _leaveSent = false;
      _heartbeatFailureCount = 0;
      if (_lifecycleState == AppLifecycleState.resumed &&
          !_isManualRejoinInFlight &&
          _callHealthState != _CallHealthState.healthy) {
        _appendCallEvent('การเชื่อมต่อกลับมาเสถียรแล้ว');
        _setCallHealthState(_CallHealthState.healthy);
      }
    } on PatientVideoApiException catch (error) {
      _heartbeatFailureCount += 1;
      if (error.statusCode == 401 || error.statusCode == 403) {
        _appendCallEvent('สิทธิ์เข้าห้องหมดอายุ ต้องเข้าห้องใหม่', isCritical: true);
        _setCallHealthState(
          _CallHealthState.rejoinRequired,
          message: 'สิทธิ์เข้าห้องหมดอายุแล้ว กรุณาเข้าห้องใหม่อีกครั้ง',
        );
        return;
      }

      if (_heartbeatFailureCount >= _heartbeatRejoinThreshold) {
        _appendCallEvent('คอลหลุดนานเกินไป ต้องเข้าห้องใหม่', isCritical: true);
        _setCallHealthState(
          _CallHealthState.rejoinRequired,
          message: 'คอลหลุดนานเกินไปแล้ว กรุณาเข้าห้องใหม่อีกครั้ง',
        );
        return;
      }

      if (_heartbeatFailureCount >= _heartbeatReconnectingThreshold) {
        _appendCallEvent('กำลังพยายามเชื่อมต่อคอลใหม่อัตโนมัติ');
        _setCallHealthState(
          _CallHealthState.reconnecting,
          message: 'กำลังพยายามเชื่อมต่อคอลใหม่อัตโนมัติ',
        );
        return;
      }

      if (_heartbeatFailureCount >= _heartbeatDegradedThreshold) {
        _appendCallEvent('สัญญาณเริ่มไม่เสถียร เสียงหรือภาพอาจกระตุก');
        _setCallHealthState(
          _CallHealthState.degraded,
          message: 'สัญญาณเริ่มไม่เสถียร เสียงหรือภาพอาจกระตุกชั่วคราว',
        );
      }
    } catch (_) {
      _heartbeatFailureCount += 1;
      if (_heartbeatFailureCount >= _heartbeatRejoinThreshold) {
        _appendCallEvent('คอลหลุดนานเกินไป ต้องเข้าห้องใหม่', isCritical: true);
        _setCallHealthState(
          _CallHealthState.rejoinRequired,
          message: 'คอลหลุดนานเกินไปแล้ว กรุณาเข้าห้องใหม่อีกครั้ง',
        );
        return;
      }
      if (_heartbeatFailureCount >= _heartbeatReconnectingThreshold) {
        _appendCallEvent('กำลังพยายามเชื่อมต่อคอลใหม่อัตโนมัติ');
        _setCallHealthState(
          _CallHealthState.reconnecting,
          message: 'กำลังพยายามเชื่อมต่อคอลใหม่อัตโนมัติ',
        );
        return;
      }
      _appendCallEvent('สัญญาณเริ่มไม่เสถียร เสียงหรือภาพอาจกระตุก');
      _setCallHealthState(
        _CallHealthState.degraded,
        message: 'สัญญาณเริ่มไม่เสถียร เสียงหรือภาพอาจกระตุกชั่วคราว',
      );
    }
  }

  Future<void> _sendPresenceLeave() async {
    if (_leaveSent) return;
    if ((widget.inviteToken ?? '').trim().isEmpty &&
        (widget.shortCode ?? '').trim().isEmpty) {
      return;
    }
    try {
      await _videoApiClient.sendPatientPresenceLeave(
        meetingId: _activeSession.meetingId,
        inviteToken: widget.inviteToken,
        shortCode: widget.shortCode,
      );
      _leaveSent = true;
    } catch (_) {
      // best-effort
    }
  }

  Future<void> _enableImmersiveMode() async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }

  Future<void> _restoreSystemUiMode() async {
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  }

  void _setCallHealthState(_CallHealthState nextState, {String? message}) {
    if (!mounted) {
      _callHealthState = nextState;
      _callHealthMessage = message;
      return;
    }
    if (_callHealthState == nextState && _callHealthMessage == message) {
      return;
    }
    setState(() {
      _callHealthState = nextState;
      _callHealthMessage = message;
    });
  }

  void _appendCallEvent(String message, {bool isCritical = false}) {
    final trimmed = message.trim();
    if (trimmed.isEmpty) return;
    final event = _CallReliabilityEvent(
      at: _currentClockLabel(),
      message: trimmed,
      isCritical: isCritical,
    );
    if (_callEvents.isNotEmpty &&
        _callEvents.first.message == event.message &&
        _callEvents.first.isCritical == event.isCritical) {
      return;
    }
    setState(() {
      _callEvents.insert(0, event);
      if (_callEvents.length > 6) {
        _callEvents.removeRange(6, _callEvents.length);
      }
    });
  }

  bool get _canAttemptManualRejoin {
    return (widget.inviteToken ?? '').trim().isNotEmpty ||
        (widget.shortCode ?? '').trim().isNotEmpty;
  }

  Future<void> _handleManualRejoin() async {
    if (_isManualRejoinInFlight) return;
    if (!_canAttemptManualRejoin) {
      _setCallHealthState(
        _CallHealthState.rejoinRequired,
        message: 'ไม่มีลิงก์ห้องสำหรับเชื่อมต่อใหม่ กรุณาขอลิงก์จากแพทย์อีกครั้ง',
      );
      return;
    }

    setState(() {
      _isManualRejoinInFlight = true;
      _callHealthState = _CallHealthState.reconnecting;
      _callHealthMessage = 'กำลังเชื่อมต่อห้องใหม่อีกครั้ง';
    });
    _appendCallEvent('คนไข้สั่งเชื่อมต่อห้องใหม่ด้วยตนเอง');
    _stopPresenceHeartbeat();

    try {
      final refreshedSession = await _videoApiClient.issuePatientVideoToken(
        meetingId: _activeSession.meetingId,
        inviteToken: widget.inviteToken,
        shortCode: widget.shortCode,
      );
      if (refreshedSession.provider != 'zego') {
        throw const PatientVideoApiException(
          'นัดหมายนี้ยังไม่ได้ตั้งค่า ZEGO provider',
        );
      }

      if (!mounted) return;
      setState(() {
        _activeSession = refreshedSession;
        _conferenceEpoch += 1;
        _heartbeatFailureCount = 0;
        _leaveSent = false;
        _callHealthState = _CallHealthState.healthy;
        _callHealthMessage = null;
      });
      _appendCallEvent('เชื่อมต่อห้องใหม่สำเร็จ');
      _startPresenceHeartbeat();
    } on PatientVideoApiException catch (error) {
      _appendCallEvent(error.message, isCritical: true);
      _setCallHealthState(
        _CallHealthState.rejoinRequired,
        message: error.message,
      );
    } catch (_) {
      _appendCallEvent('ยังเชื่อมต่อกลับไม่ได้ กรุณาลองใหม่อีกครั้ง',
          isCritical: true);
      _setCallHealthState(
        _CallHealthState.rejoinRequired,
        message: 'ยังเชื่อมต่อกลับไม่ได้ กรุณาลองใหม่อีกครั้ง',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isManualRejoinInFlight = false;
        });
      } else {
        _isManualRejoinInFlight = false;
      }
    }
  }

  _CallHealthPresentation? _buildCallHealthPresentation() {
    final message = _callHealthMessage;
    switch (_callHealthState) {
      case _CallHealthState.healthy:
        return null;
      case _CallHealthState.degraded:
        return _CallHealthPresentation(
          title: 'สัญญาณไม่เสถียร',
          message: message ??
              'ระบบยังพยายามรักษาคอลอยู่ เสียงหรือภาพอาจกระตุกชั่วคราว',
          icon: Icons.network_check_rounded,
          backgroundColor: const Color(0xCC78350F),
          borderColor: const Color(0x66FBBF24),
          foregroundColor: const Color(0xFFFFFBEB),
          buttonLabel: 'ลองเชื่อมต่อใหม่',
          showSpinner: false,
        );
      case _CallHealthState.reconnecting:
        return _CallHealthPresentation(
          title: 'กำลังเชื่อมต่อใหม่',
          message: message ?? 'กรุณาเปิดหน้านี้ค้างไว้ ระบบกำลังพยายามกลับเข้าคอล',
          icon: Icons.sync_rounded,
          backgroundColor: const Color(0xCC1D4ED8),
          borderColor: const Color(0x6648A3FF),
          foregroundColor: const Color(0xFFEFF6FF),
          buttonLabel: 'ลองอีกครั้ง',
          showSpinner: true,
        );
      case _CallHealthState.rejoinRequired:
        return _CallHealthPresentation(
          title: 'ต้องเข้าห้องใหม่',
          message: message ??
              'ระบบกู้การเชื่อมต่อกลับมาไม่สำเร็จ กรุณาเข้าห้องใหม่อีกครั้ง',
          icon: Icons.refresh_rounded,
          backgroundColor: const Color(0xCC7F1D1D),
          borderColor: const Color(0x66FCA5A5),
          foregroundColor: const Color(0xFFFFF1F2),
          buttonLabel: 'เข้าห้องอีกครั้ง',
          showSpinner: false,
        );
    }
  }

  Future<bool> _confirmLeaveCall() async {
    final shouldLeave = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('ออกจากวิดีโอคอล?'),
          content: const Text(
            'หากออกจากหน้านี้ การคอลบนอุปกรณ์นี้จะสิ้นสุดทันที',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('อยู่ต่อ'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('ออก'),
            ),
          ],
        );
      },
    );
    final leaveNow = shouldLeave ?? false;
    if (leaveNow) {
      await _sendPresenceLeave();
    }
    return leaveNow;
  }

  @override
  Widget build(BuildContext context) {
    final configError = AppConfig.validate();
    if (configError != null) {
      return _ConfigurationErrorScreen(errorMessage: configError);
    }
    final backendAppId = _activeSession.appId;
    if (backendAppId == null || backendAppId <= 0) {
      return const _ConfigurationErrorScreen(
        errorMessage: 'Missing app_id from backend video session.',
      );
    }

    final configuredAppId = AppConfig.zegoAppId;
    if (configuredAppId > 0 && configuredAppId != backendAppId) {
      return _ConfigurationErrorScreen(
        errorMessage:
            'ZEGO_APP_ID mismatch. App config=$configuredAppId but backend session=$backendAppId. Please use same ZEGO project for doctor and patient.',
      );
    }

    final conferenceConfig = ZegoUIKitPrebuiltVideoConferenceConfig(
      turnOnCameraWhenJoining: widget.startWithCamera,
      turnOnMicrophoneWhenJoining: widget.startWithMicrophone,
      useFrontFacingCamera: true,
      useSpeakerWhenJoining: true,
      onLeaveConfirmation: (BuildContext _) async {
        return _confirmLeaveCall();
      },
      onLeave: () {
        _setCallHealthState(
          _CallHealthState.rejoinRequired,
          message: 'ออกจากคอลแล้ว หากต้องการกลับเข้าใหม่ให้กดเข้าห้องอีกครั้ง',
        );
        _stopPresenceHeartbeat();
        unawaited(_sendPresenceLeave());
        if (!mounted) return;
        final navigator = Navigator.of(context);
        if (navigator.canPop()) {
          navigator.pop();
        }
      },
    );

    final isActive = _lifecycleState == AppLifecycleState.resumed;
    final lifecycleLabel = isActive ? 'เชื่อมต่ออยู่' : 'อยู่เบื้องหลัง';
    final roomLabel = _activeSession.roomId.length > 18
        ? '${_activeSession.roomId.substring(0, 18)}...'
        : _activeSession.roomId;
    final callHealth = _buildCallHealthPresentation();

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) {
          return;
        }

        final shouldLeave = await _confirmLeaveCall();
        if (!context.mounted || !shouldLeave) {
          return;
        }
        Navigator.of(context).pop();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF050B1A),
        body: Stack(
          children: [
            Positioned.fill(
              child: ZegoUIKitPrebuiltVideoConference(
                key: ValueKey('zego-room-$_conferenceEpoch-${_activeSession.token}'),
                appID: backendAppId,
                appSign: AppConfig.zegoAppSign,
                userID: _activeSession.userId,
                userName: widget.displayName.trim(),
                conferenceID: _activeSession.roomId,
                config: conferenceConfig,
              ),
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: IgnorePointer(
                child: Container(
                  height: 110,
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Color(0xB3000000),
                        Color(0x22000000),
                        Color(0x00000000)
                      ],
                    ),
                  ),
                ),
              ),
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        _TopGlassActionButton(
                          icon: Icons.arrow_back_rounded,
                          label: 'กลับ',
                          onPressed: () async {
                            final shouldLeave = await _confirmLeaveCall();
                            if (!context.mounted || !shouldLeave) return;
                            Navigator.of(context).pop();
                          },
                        ),
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xCC0F172A),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: isActive
                                  ? const Color(0x5A4ADE80)
                                  : const Color(0x52F59E0B),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.shield_moon_outlined,
                                size: 14,
                                color: isActive
                                    ? const Color(0xFF86EFAC)
                                    : const Color(0xFFFDE68A),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                lifecycleLabel,
                                style: TextStyle(
                                  fontSize: 11,
                                  color: isActive
                                      ? const Color(0xFFD1FAE5)
                                      : const Color(0xFFFEF3C7),
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                      decoration: BoxDecoration(
                        color: const Color(0xA00F172A),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: const Color(0x2A94A3B8)),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.verified_user_outlined,
                            size: 14,
                            color: Color(0xFFBFDBFE),
                          ),
                          const SizedBox(width: 7),
                          Expanded(
                            child: Text(
                              'ห้องคอลปลอดภัย • ห้อง $roomLabel',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFFDCE7F7),
                                fontWeight: FontWeight.w600,
                                fontSize: 11,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (callHealth != null)
              Positioned(
                left: 14,
                right: 14,
                bottom: isActive ? 110 : 182,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: callHealth.backgroundColor,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: callHealth.borderColor),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x22000000),
                        blurRadius: 16,
                        offset: Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: callHealth.showSpinner &&
                                _isManualRejoinInFlight
                            ? SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.1,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    callHealth.foregroundColor,
                                  ),
                                ),
                              )
                            : Icon(
                                callHealth.icon,
                                color: callHealth.foregroundColor,
                                size: 18,
                              ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              callHealth.title,
                              style: TextStyle(
                                color: callHealth.foregroundColor,
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              callHealth.message,
                              style: TextStyle(
                                color: callHealth.foregroundColor,
                                fontSize: 12,
                                height: 1.35,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: FilledButton.tonal(
                                onPressed: _isManualRejoinInFlight ||
                                        !_canAttemptManualRejoin
                                    ? null
                                    : _handleManualRejoin,
                                style: FilledButton.styleFrom(
                                  backgroundColor: const Color(0x1AFFFFFF),
                                  foregroundColor: callHealth.foregroundColor,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 8,
                                  ),
                                  textStyle: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 12,
                                  ),
                                ),
                                child: Text(
                                  _isManualRejoinInFlight
                                      ? 'กำลังเชื่อมต่อ...'
                                      : callHealth.buttonLabel,
                                ),
                              ),
                            ),
                            if (_callEvents.isNotEmpty) ...[
                              const SizedBox(height: 10),
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  color: const Color(0x14000000),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: callHealth.borderColor.withValues(
                                      alpha: 0.7,
                                    ),
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Text(
                                          'กิจกรรมล่าสุด',
                                          style: TextStyle(
                                            color: callHealth.foregroundColor,
                                            fontWeight: FontWeight.w700,
                                            fontSize: 11,
                                          ),
                                        ),
                                        const Spacer(),
                                        TextButton(
                                          onPressed: () {
                                            setState(() {
                                              _showCallEvents = !_showCallEvents;
                                            });
                                          },
                                          style: TextButton.styleFrom(
                                            foregroundColor:
                                                callHealth.foregroundColor,
                                            padding: EdgeInsets.zero,
                                            minimumSize: const Size(52, 28),
                                            tapTargetSize:
                                                MaterialTapTargetSize.shrinkWrap,
                                          ),
                                          child: Text(
                                            _showCallEvents
                                                ? 'ซ่อน'
                                                : 'ดูเพิ่ม',
                                            style: const TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      '${_callEvents.first.at} • ${_callEvents.first.message}',
                                      style: TextStyle(
                                        color: _callEvents.first.isCritical
                                            ? const Color(0xFFFECACA)
                                            : callHealth.foregroundColor,
                                        fontSize: 11,
                                        height: 1.35,
                                      ),
                                    ),
                                    if (_showCallEvents) ...[
                                      const SizedBox(height: 6),
                                      ..._callEvents.skip(1).take(2).map(
                                        (event) => Padding(
                                          padding:
                                              const EdgeInsets.only(bottom: 4),
                                          child: Text(
                                            '${event.at} • ${event.message}',
                                            style: TextStyle(
                                              color: event.isCritical
                                                  ? const Color(0xFFFECACA)
                                                  : callHealth.foregroundColor,
                                              fontSize: 11,
                                              height: 1.35,
                                            ),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            if (!isActive)
              Positioned(
                left: 14,
                right: 14,
                bottom: callHealth != null ? 198 : 110,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xCC78350F),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0x66FBBF24)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.info_outline,
                          color: Color(0xFFFEF3C7), size: 16),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'แอปทำงานเบื้องหลังอยู่ สามารถกลับเข้าหน้านี้ได้ทุกเมื่อ',
                          style: TextStyle(
                            color: Color(0xFFFFFBEB),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TopGlassActionButton extends StatelessWidget {
  const _TopGlassActionButton({
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xB30F172A),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: Colors.white),
              const SizedBox(width: 6),
              Text(
                label,
                style: const TextStyle(
                  color: Color(0xFFE2E8F0),
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConfigurationErrorScreen extends StatelessWidget {
  const _ConfigurationErrorScreen({required this.errorMessage});

  final String errorMessage;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Text(
              errorMessage,
              style: const TextStyle(fontSize: 15),
            ),
          ),
        ),
      ),
    );
  }
}
