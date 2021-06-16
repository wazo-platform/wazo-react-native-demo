import React, { useReducer, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Dimensions, Platform } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import ramdomUuid from 'uuid-random';
import {Container, Content, Form, Input, Item, Label, Button, Footer } from 'native-base';
import { RTCPeerConnection, RTCSessionDescription, MediaStream, mediaDevices, RTCView } from 'react-native-webrtc';
import MediaStreamTrackEvent from 'react-native-webrtc/MediaStreamTrackEvent';
import MediaStreamTrack from 'react-native-webrtc/MediaStreamTrack';
import Wazo from '@wazo/sdk/lib/simple';
import AsyncStorage from '@react-native-community/async-storage';

// Polyfill webrtc
global.MediaStream = MediaStream;
global.MediaStreamTrack = MediaStreamTrack;
global.RTCSessionDescription = RTCSessionDescription;
global.RTCPeerConnection = RTCPeerConnection;
global.window.RTCPeerConnection = RTCPeerConnection;
if (global.navigator) {
  global.navigator.mediaDevices = {
    ...global.navigator.mediaDevices || {},
    getUserMedia: mediaDevices.getUserMedia,
  };
} else {
  global.navigator = {};
}
global.MediaStreamTrackEvent = MediaStreamTrackEvent;
global.InstallTrigger = true;

const styles = StyleSheet.create({
  content: {
    flex: 1,
    position: 'relative',
  },
  form: {
    backgroundColor: 'white',
  },
  buttonsContainer: {
    flex: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
  },
  button: {
    margin: 10,
    flex: 1,
    alignItems: 'center',
    textAlign: 'center',
  },
  centeredText: {
    flex: 1,
    alignItems: 'center',
    textAlign: 'center',
  },
  localVideo: {
    width: 100,
    height: 100,
    position: 'absolute',
    right: 10,
    bottom: 60,
  },
  remoteVideo: {
    flex: 1,
    position: 'absolute',
    left: 0,
    top: 0,
    margin: 0,
    padding: 0,
    aspectRatio: 1,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    overflow: 'hidden',
    alignItems: 'center',
  },
});

const isIOS = Platform.OS === 'ios';

const reducer = (state, action) => ({ ...state, ...action});
const initialState = {
  ready: false,
  number: '',
  ringing: false,
  held: false,
  videoHeld: false,
  error: null,
  localStreamURL: null,
  remoteStreamURL: null,
};

// Can't be put in react state or it won't be updated in callkeep events.
let currentSession;
let inCall = false;

const foregroundService = {
  channelId: 'io.wazo.demo',
  channelName: 'Call active with wazo demo',
  notificationTitle: 'Wazo demo is currently active',
};

const Dialer = ({ onLogout }) => {
  const [ state, dispatch ] = useReducer(reducer, initialState);
  const { number, ringing, held, localStreamURL, remoteStreamURL, ready, videoHeld } = state;
  let currentCallId = useRef(null);
  let localStream = useRef(null);
  let remoteStream = useRef(null);

  const getCurrentCallId = () => {
    if (!currentCallId.current) {
      currentCallId.current = ramdomUuid().toUpperCase();
    }

    return currentCallId.current;
  };

  const init = async () => {
    await initializeWebRtc();
    await initializeCallKeep();
    displayLocalVideo();

    dispatch({ ready: true });
  };

  const initializeWebRtc = async () => {
    await Wazo.Phone.connect({ audio: true, video: true });

    Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, callSession => {
      setupCallSession(callSession);
      currentSession = callSession;
      dispatch({ ringing: true });

      // Tell callkeep that we a call is incoming for audio calls
      const { number } = callSession;
      console.log('displayIncoming', getCurrentCallId());
      RNCallKeep.displayIncomingCall(getCurrentCallId(), number, number, 'number', true);
    });
  };

  const initializeCallKeep = async () => {
    try {
      RNCallKeep.setup({
        ios: {
          appName: 'WazoReactNativeDemo',
        },
        android: {
          alertTitle: 'Permissions required',
          alertDescription: 'This application needs to access your phone accounts',
          cancelButton: 'Cancel',
          okButton: 'ok',
          foregroundService
        }
      });
      RNCallKeep.setAvailable(true);
      if (!isIOS) {
        RNCallKeep.registerAndroidEvents();
        RNCallKeep.canMakeMultipleCalls(false);
        RNCallKeep.setForegroundServiceSettings(foregroundService);
      }
    } catch (err) {
      console.error('initializeCallKeep error:', err.message);
    }

    // Add RNCallKit Events
    RNCallKeep.addEventListener('didReceiveStartCallAction', onNativeCall);
    RNCallKeep.addEventListener('answerCall', onAnswerCallAction);
    RNCallKeep.addEventListener('endCall', onEndCallAction);
    RNCallKeep.addEventListener('didDisplayIncomingCall', onIncomingCallDisplayed);
    RNCallKeep.addEventListener('didPerformSetMutedCallAction', onToggleMute);
    RNCallKeep.addEventListener('didPerformDTMFAction', onDTMF);
    RNCallKeep.addEventListener('didToggleHoldCallAction', onToggleHold);
  };

  const getLocalStream = () => mediaDevices.getUserMedia({
    audio: true,
    video: {
      mandatory: {
        minWidth: 500,
        minHeight: 300,
        minFrameRate: 30
      },
      facingMode: 'user',
    }
  });

  const displayLocalVideo = () => {
    getLocalStream().then((stream) => {
      dispatch({ localStreamURL: stream.toURL() });
    });
  };

  const setupCallSession = callSession => {
    currentSession = callSession;

    Wazo.Phone.on(Wazo.Phone.ON_CALL_FAILED, (response, cause) => {
      inCall = false;
      dispatch({ error: cause, ringing: false });
    });

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ERROR, (response, cause) => {
      inCall = false;
      dispatch({ error: cause, ringing: false });
    });

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED, () => {
      onCallTerminated();
    });

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, () => {
      const session = Wazo.Phone.getCurrentSipSession();
      // Setup local stream
      if (callSession.cameraEnabled) {
        const { peerConnection } = session.sessionDescriptionHandler;
        localStream.current = peerConnection.getLocalStreams().find(stream => !!stream.getVideoTracks().length);
        remoteStream .current= peerConnection.getRemoteStreams().find(stream => !!stream.getVideoTracks().length);

        dispatch({
          localStreamURL: localStream.current ? localStream.current.toURL() : null,
          remoteStreamURL: remoteStream.current ? remoteStream.current.toURL() : null,
        });

        // On Android display the app when answering a video call
        if (!isIOS) {
          RNCallKeep.backToForeground();
        }
      }

      RNCallKeep.setCurrentCallActive(getCurrentCallId());
    });
  };

  const call = async (number, video = false) => {
    const session = await Wazo.Phone.call(number, video);
    setupCallSession(session);

    inCall = true;
    await dispatch({ ringing: false });

    console.log('startCall', getCurrentCallId());
    RNCallKeep.startCall(getCurrentCallId(), number, number, 'number', video);
  };

  const answer = withVideo => {
    inCall = true;
    dispatch({ ringing: false });
    RNCallKeep.setCurrentCallActive(getCurrentCallId());

    Wazo.Phone.accept(currentSession, withVideo);
  };

  const hangup = async () => {
    if (!currentSession) {
      return;
    }

    try {
      await Wazo.Phone.hangup(currentSession);
    } catch (e) {
      // Nothing to do
    }

    onCallTerminated();
  };

  const onCallTerminated = () => {
    if (!currentCallId.current || !currentSession) {
      return;
    }

    // Don't call endCall on Android when camera is enabled
    RNCallKeep.endCall(getCurrentCallId());

    inCall = false;
    dispatch({
      ringing: false,
      remoteStreamURL: null,
      localStreamURL: null,
    });

    if (remoteStream.current) {
      remoteStream.current.release();
      remoteStream.current = null;
    }
    if (localStream.current) {
      localStream.current.release();
      localStream.current = null;
    }

    currentCallId.current = null;
    currentSession = null;

    displayLocalVideo();
  };

  const onAnswerCallAction = ({ callUUID }) => {
    // called when the user answer the incoming call
    answer(true);

    RNCallKeep.setCurrentCallActive(callUUID);

    // On Android display the app when answering a video call
    if (!isIOS && currentSession.cameraEnabled) {
      RNCallKeep.backToForeground();
    }
  };

  const onIncomingCallDisplayed = ({ callUUID, handle, fromPushKit }) => {
    // Incoming call displayed (used for pushkit on iOS)
  };

  const onNativeCall = ({ handle }) => {
    // _onOutGoingCall on android is also called when making a call from the app
    // so we have to check in order to not making 2 calls
    if (inCall) {
      return;
    }
    // Called when performing call from native Contact app
    call(handle);
  };

  const toggleHold = shouldHold => {
    if (!currentSession) {
      return;
    }
    Wazo.Phone[shouldHold ? 'hold' : 'resume'](currentSession);
    dispatch({ held: shouldHold });
  };

  const toggleVideoHold = () => {
    if (!currentSession) {
      return;
    }
    Wazo.Phone[videoHeld ? 'turnCameraOn' : 'turnCameraOff'](currentSession);
    dispatch({ videoHeld: !videoHeld });
  };

  const onEndCallAction = ({ callUUID }) => {
    hangup();
  };

  const onToggleMute = (muted) => {
    if (!currentSession) {
      return;
    }
    // Called when the system or the user mutes a call
    Wazo.Phone[muted ? 'mute' : 'unmute'](currentSession);
  };

  const onToggleHold = ({ callUUID, hold }) => {
    toggleHold(hold);
  };

  const onDTMF = (action) => {
    console.log('onDTMF', action);
  };

  const logout = async () => {
    if (currentSession) {
      await hangup();
    }
    Wazo.Auth.logout();
    await AsyncStorage.removeItem('token');

    onLogout();
  };

  useEffect(() => {
    init();
  }, []);

  const isVideo = currentSession && currentSession.cameraEnabled;

  return (
    <Container style={styles.content}>
      {!isIOS && localStreamURL && (<RTCView mirror streamURL={localStreamURL} style={styles.localVideo} zOrder={1} />)}

      {remoteStreamURL && <RTCView objectFit="cover" streamURL={remoteStreamURL} style={styles.remoteVideo} zOrder={15} />}

      <Content style={styles.content}>
        <Form style={styles.form}>
          <Item stackedLabel>
            <Label>Extension</Label>
            <Input
              autoCapitalize="none"
              onChangeText={value => dispatch({ number: value })}
              value={number}
            />
          </Item>
        </Form>

        {!ringing && !inCall && (
          <View style={styles.buttonsContainer}>
            <Button block disabled={!ready} onPress={() => call(number, false)} style={styles.button}>
              <Text>Call</Text>
            </Button>
            <Button block disabled={!ready} onPress={() => call(number, true)} style={styles.button}>
              <Text>Video call</Text>
            </Button>
          </View>
        )}
        {currentSession && ringing && (
          <View style={styles.buttonsContainer}>
            <Button onPress={() => answer(false)} style={styles.button}>
              <Text style={styles.centeredText}>
                Answer audio call from {currentSession.number}
                </Text>
            </Button>
            <Button onPress={() => answer(true)} style={styles.button}>
              <Text style={styles.centeredText}>
                Answer video call from {currentSession.number}
                </Text>
            </Button>
          </View>
        )}

        {inCall && (
          <View style={styles.buttonsContainer}>
            <Button block onPress={hangup} style={styles.button}>
              <Text>Hangup</Text>
            </Button>
            <Button block onPress={() => toggleHold(!held)} style={styles.button}>
              <Text>{held ? 'Unhold' : 'Hold' }</Text>
            </Button>
            {isVideo && (
              <Button block onPress={toggleVideoHold} style={styles.button}>
                <Text>{videoHeld ? 'Camera On' : 'Camera Off' }</Text>
              </Button>
            )}
          </View>
        )}
      </Content>
      {isIOS && localStreamURL && (<RTCView mirror streamURL={localStreamURL} style={styles.localVideo} zOrder={1} />)}
      <Footer>
        <Button transparent onPress={logout}>
          <Text>Logout</Text>
        </Button>
      </Footer>
    </Container>
  );
};

export default Dialer;
