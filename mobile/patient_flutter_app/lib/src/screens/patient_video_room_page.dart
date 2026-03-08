import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:zego_uikit_prebuilt_video_conference/zego_uikit_prebuilt_video_conference.dart';

import '../config/app_config.dart';
import '../models/patient_video_session.dart';
import '../services/patient_video_api_client.dart';

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

  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;
  Timer? _presenceTimer;
  bool _leaveSent = false;
  late final PatientVideoApiClient _videoApiClient;

  @override
  void initState() {
    super.initState();
    _videoApiClient = PatientVideoApiClient(baseUrl: AppConfig.telemedApiBaseUrl);
    WidgetsBinding.instance.addObserver(this);
    _enableImmersiveMode();
    _startPresenceHeartbeat();
  }

  @override
  void dispose() {
    _stopPresenceHeartbeat();
    // Dispose cannot await network I/O, so leaving room is best-effort here.
    _sendPresenceLeave();
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
      _startPresenceHeartbeat();
    } else if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _stopPresenceHeartbeat();
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
        meetingId: widget.session.meetingId,
        inviteToken: widget.inviteToken,
        shortCode: widget.shortCode,
      );
      _leaveSent = false;
    } catch (_) {
      // best-effort
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
        meetingId: widget.session.meetingId,
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

  Future<bool> _confirmLeaveCall() async {
    final shouldLeave = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Leave video call?'),
          content: const Text(
            'If you leave this page, your call session will end on this device.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Stay'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Leave'),
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
    final backendAppId = widget.session.appId;
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
    final roomLabel =
        widget.session.roomId.length > 18 ? '${widget.session.roomId.substring(0, 18)}...' : widget.session.roomId;

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
                appID: backendAppId,
                appSign: AppConfig.zegoAppSign,
                userID: widget.session.userId,
                userName: widget.displayName.trim(),
                conferenceID: widget.session.roomId,
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
                      colors: [Color(0xB3000000), Color(0x22000000), Color(0x00000000)],
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
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xCC0F172A),
                            borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                              color: isActive ? const Color(0x5A4ADE80) : const Color(0x52F59E0B),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.shield_moon_outlined,
                                size: 14,
                                color: isActive ? const Color(0xFF86EFAC) : const Color(0xFFFDE68A),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                lifecycleLabel,
                                style: TextStyle(
                                  fontSize: 11,
                                  color: isActive ? const Color(0xFFD1FAE5) : const Color(0xFFFEF3C7),
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
                              'Secure consultation • Room $roomLabel',
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
            if (!isActive)
              Positioned(
                left: 14,
                right: 14,
                bottom: 110,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xCC78350F),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0x66FBBF24)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.info_outline, color: Color(0xFFFEF3C7), size: 16),
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
