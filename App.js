import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, TextInput } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import getApiClient, { setCurrentServer } from '@wazo/sdk/lib/service/getApiClient';
import uuid from 'uuid';
import VoipPushNotification from 'react-native-voip-push-notification';

import { RTCPeerConnection, RTCSessionDescription, MediaStream, mediaDevices } from 'react-native-webrtc';

import WazoWebRTCClient from '@wazo/sdk/lib/web-rtc-client';

// Polyfill WebRTC
global.MediaStream = MediaStream;
global.RTCSessionDescription = RTCSessionDescription;
global.RTCPeerConnection = RTCPeerConnection;
global.navigator.mediaDevices = {
  ...global.navigator.mediaDevices,
  getUserMedia: mediaDevices.getUserMedia,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    width: '80%',
  },
  button: {
    marginTop: 50,
  },
});
const hitSlop = { top: 10, left: 10, right: 10, bottom: 10};

let apnsToken;

export default class App extends React.Component {

  constructor(props) {
    super(props);

    // VoipPushNotification.requestPermissions();
    // VoipPushNotification.addEventListener('register', async (token) => {
    //   apnsToken = token;
    // });

    this.webRtcClient = null;
    this.currentCallId = null;
    this.currentSession = null;

    this.state = {
      server: 'demo.wazo.community',
      username: 'equentin@wazo.io',
      password: '',
      number: '8008',
      localVideoSrc: null,
      remoteVideoSrc: null,
      connected: false,
      ringing: false,
      inCall: false,
      held: false,
      error: null,
    };
  }

  initializeCallKeep = async (userUuid) => {
     await this.apiClient.auth.removeDeviceToken(userUuid);
     this.apiClient.auth.sendDeviceToken(userUuid, null, apnsToken);

    // Initialise RNCallKit
    const options = {
      ios: {
        appName: 'WazoReactNativeDemo',
      },
      android: {
        alertTitle: 'Permissions required',
        alertDescription: 'This application needs to access your phone accounts',
        cancelButton: 'Cancel',
        okButton: 'ok',
      }
    };

    try {
      RNCallKeep.setup(options);
      RNCallKeep.setAvailable(true);
    } catch (err) {
      console.error('initializeCallKeep error:', err.message);
    }

    // Add RNCallKit Events
    RNCallKeep.addEventListener('didReceiveStartCallAction', this.onNativeCall);
    RNCallKeep.addEventListener('answerCall', this.onAnswerCallAction);
    RNCallKeep.addEventListener('endCall', this.onEndCallAction);
    RNCallKeep.addEventListener('didDisplayIncomingCall', this.onIncomingCallDisplayed);
    RNCallKeep.addEventListener('didPerformSetMutedCallAction', this.onToggleMute);
    RNCallKeep.addEventListener('didPerformDTMFAction', this.onDTMF);
  };

  authenticate = () => {
    const { server, username, password } = this.state;
    setCurrentServer(server);
    this.apiClient = getApiClient();

    this.apiClient.auth
      .logIn({ username, password })
      .then(data => {
        this.apiClient.setToken(data.token);

        this.apiClient.confd
          .getUser(data.uuid)
          .then(user => {
            const line = user.lines[0];

            this.apiClient.confd
              .getUserLineSip(data.uuid, line.id)
              .then(sipLine => {
                this.initializeWebRtc(sipLine, server);
                this.initializeCallKeep(data.uuid);
              })
              .catch(console.log);
          })
          .catch(console.log);
      })
      .catch(console.log);
  };

  getVideoSourceId = () => {
    if (Platform.OS !== 'ios') {
      // on android, you don't have to specify sourceId manually, just use facingMode
      return;
    }

    // MediaStreamTrack.getSources(sourceInfos => {
    //   for (let i = 0; i < sourceInfos.length; i++) {
    //     const sourceInfo = sourceInfos[i];
    //     if(sourceInfo.kind === 'video' && sourceInfo.facing === 'front') {
    //       return sourceInfo.id;
    //     }
    //   }
    // });
  };

  initializeWebRtc = (sipLine, host) => {
    this.webRtcClient = new WazoWebRTCClient({
      host,
      displayName: 'My dialer',
      authorizationUser: sipLine.username,
      password: sipLine.secret,
      uri: sipLine.username + '@' + host,
      log: { builtinEnabled: true, },
      media: {
        audio: true,
      },
      iceCheckingTimeout: 5000,
    });

    this.webRtcClient.on('invite', session => {
      this.setupCallSession(session);
      this.setState({ ringing: true });

      // Tell callkeep that we a call is incoming
      RNCallKeep.displayIncomingCall(this.getCurrentCallId(), this.webRtcClient.getNumber(session));
    });

    this.setState({ connected: true });
  };

  setupCallSession = session => {
    this.currentSession = session;

    session.on('failed', (response, cause) => {
      this.setState({ error: cause, ringing: false, inCall: false });
    });

    session.on('terminated', () => {
      this.hangup();
    });
  };

  call = (number) => {
    const session = this.webRtcClient.call(number);
    this.setupCallSession(session);

    this.setState({ inCall: true, ringing: false });

    // Tell callkit that we are in call
    RNCallKeep.startCall(this.getCurrentCallId(), number);
  };

  answer = () => {
    this.setState({ inCall: true, ringing: false });
    RNCallKeep.setCurrentCallActive();

    this.webRtcClient.answer(this.currentSession);
  };

  hangup = () => {
    const currentCallId = this.getCurrentCallId();
    if (!this.currentSession || !currentCallId) {
      return;
    }

    this.webRtcClient.hangup(this.currentSession);

    // RNCallKeep.endCall(currentCallId);
    this.setState({ inCall: false, ringing: false });
    this.currentCallId = null;
    this.currentSession = null;
  };

  getCurrentCallId = () => {
    if (!this.currentCallId) {
      this.currentCallId = uuid.v4();
    }

    return this.currentCallId;
  };

  onAnswerCallAction = ({ callUUID }) => {
    // called when the user answer the incoming call
    this.answer();
  };

  onIncomingCallDisplayed = ({ callUUID, handle, fromPushKit }) => {
    console.log('onIncomingCallDisplayed', callUUID);
    // You will get this event after RNCallKeep finishes showing incoming call UI
    // You can check if there was an error while displaying
  };

  onNativeCall = ({ handle }) => {
    // _onOutGoingCall on android is also called when making a call from the app
    // so we have to check in order to not making 2 calls
    if (this.state.inCall) {
      return;
    }
    // Called when performing call from native Contact app
    this.call(handle);
  };

  toggleHold = () => {
    this.webRtcClient[this.state.held ? 'unhold' : 'hold'](this.currentSession);
    this.setState({ held: !this.state.held });
  };

  onEndCallAction = ({ callUUID }) => {
    this.hangup();
  };

  onToggleMute = (muted) => {
    // Called when the system or the user mutes a call
    this.webRtcClient[muted ? 'mute' : 'unmute'](this.currentSession);
  };

  onDTMF = (action) => {
    console.log('onDTMF', action);
  };

  render() {
    const { connected, server } = this.state;

    return (
      <View style={styles.container}>
        {!connected && (
          <React.Fragment>
            <TextInput autoCapitalize="none" onChangeText={username => this.setState({ username })} placeholder="Username" value={this.state.username} style={styles.input} />
            <TextInput autoCapitalize="none" onChangeText={password => this.setState({ password })} placeholder="Password" value={this.state.password} style={styles.input} />
            <TextInput autoCapitalize="none" defaultValue={server} onChangeText={server => this.setState({ server })} placeholder="Server" style={styles.input} />

            <TouchableOpacity onPress={this.authenticate.bind(this)} style={styles.button} hitSlop={hitSlop}>
              <Text>Login</Text>
            </TouchableOpacity>
          </React.Fragment>
        )}

        {connected && (
          <React.Fragment>
            <TextInput
              autoCapitalize="none"
              onChangeText={number => this.setState({ number })}
              onSubmitEditing={this.call.bind(this)}
              placeholder="Number"
              style={styles.input}
              value={this.state.number}
            />

            {!this.state.ringing && !this.state.inCall && (
              <TouchableOpacity onPress={() => this.call(this.state.number)} style={styles.button} hitSlop={hitSlop}>
                <Text>Call</Text>
              </TouchableOpacity>
            )}
            {this.state.ringing && (
              <TouchableOpacity onPress={this.answer} style={styles.button} hitSlop={hitSlop}>
                <Text>Answer</Text>
              </TouchableOpacity>
            )}
            {this.state.inCall && (
              <React.Fragment>
                <TouchableOpacity onPress={this.hangup} style={styles.button} hitSlop={hitSlop}>
                  <Text>Hangup</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={this.toggleHold} style={styles.button} hitSlop={hitSlop}>
                  <Text>{this.state.held ? 'Unhold' : 'Hold' }</Text>
                </TouchableOpacity>
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </View>
    );
  }

}
