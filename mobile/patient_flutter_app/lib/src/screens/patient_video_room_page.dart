import 'package:flutter/material.dart';
import 'package:zego_uikit_prebuilt_video_conference/zego_uikit_prebuilt_video_conference.dart';

import '../config/app_config.dart';
import '../models/patient_video_session.dart';

class PatientVideoRoomPage extends StatefulWidget {
  const PatientVideoRoomPage({
    super.key,
    required this.session,
    required this.displayName,
    required this.startWithCamera,
    required this.startWithMicrophone,
  });

  final PatientVideoSession session;
  final String displayName;
  final bool startWithCamera;
  final bool startWithMicrophone;

  @override
  State<PatientVideoRoomPage> createState() => _PatientVideoRoomPageState();
}

class _PatientVideoRoomPageState extends State<PatientVideoRoomPage>
    with WidgetsBindingObserver {
  AppLifecycleState _lifecycleState = AppLifecycleState.resumed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    setState(() {
      _lifecycleState = state;
    });
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
    return shouldLeave ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
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
    );

    final isActive = _lifecycleState == AppLifecycleState.resumed;

    return WillPopScope(
      onWillPop: _confirmLeaveCall,
      child: Scaffold(
        backgroundColor: const Color(0xFFF3F6FB),
        appBar: AppBar(
          elevation: 0,
          backgroundColor: Colors.transparent,
          title: const Text('Patient Video Room'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () async {
              final shouldLeave = await _confirmLeaveCall();
              if (!context.mounted || !shouldLeave) return;
              Navigator.of(context).pop();
            },
          ),
        ),
        body: Column(
          children: [
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(12, 0, 12, 10),
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFD7E1F2)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(
                    spacing: 10,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.shield_moon_outlined,
                            color: theme.colorScheme.primary,
                            size: 18,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Secure consultation',
                            style: theme.textTheme.bodySmall?.copyWith(
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF1E293B),
                            ),
                          ),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(999),
                          color: isActive
                              ? const Color(0xFFDCFCE7)
                              : const Color(0xFFFEF3C7),
                        ),
                        child: Text(
                          isActive ? 'Call active' : 'Call in background',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: isActive
                                ? const Color(0xFF166534)
                                : const Color(0xFF92400E),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Room: ${widget.session.roomId}  |  AppID: $backendAppId',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: const Color(0xFF475569),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Tip: You can switch apps and come back. Avoid closing this page while consultation is active.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: const Color(0xFF64748B),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Container(
                margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: const Color(0xFFD7E1F2)),
                ),
                clipBehavior: Clip.antiAlias,
                child: ZegoUIKitPrebuiltVideoConference(
                  appID: backendAppId,
                  appSign: AppConfig.zegoAppSign,
                  userID: widget.session.userId,
                  userName: widget.displayName.trim(),
                  conferenceID: widget.session.roomId,
                  config: conferenceConfig,
                ),
              ),
            ),
          ],
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
      appBar: AppBar(title: const Text('Patient Video Room')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Text(
            errorMessage,
            style: const TextStyle(fontSize: 15),
          ),
        ),
      ),
    );
  }
}
