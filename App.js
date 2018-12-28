import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, TextInput } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import uuid from 'uuid';

import { RTCPeerConnection, RTCSessionDescription, MediaStream, getUserMedia } from 'react-native-webrtc';

import { WazoApiClient, WazoWebRTCClient } from '@wazo/sdk';

// Polyfill WebRTC
global.MediaStream = MediaStream;
global.RTCSessionDescription = RTCSessionDescription;
global.RTCPeerConnection = RTCPeerConnection;
global.navigator.mediaDevices = {
  ...global.navigator.mediaDevices,
  getUserMedia: getUserMedia,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    paddingTop: 20,
  },
});

export default class App extends React.Component {

  constructor(props) {
    super(props);

    this.webRtcClient = null;
    this.currentCallId = null;
    this.currentSession = null;

    this.state = {
      server: 'demo.wazo.community',
      username: '',
      password: '',
      number: '',
      connected: false,
      ringing: false,
      inCall: false,
      error: null,
    };
  }

  initializeCallKeep = () => {
    // Initialise RNCallKit
    const options = {
      appName: 'WazoReactNativeDemo',
      android: {
        title: 'Permissions required',
        description: 'This application needs to access your phone accounts',
        cancelButton: 'Cancel',
        okButton: 'ok',
      }
    };

    try {
      RNCallKeep.setup(options);
      RNCallKeep.setActive(true);
    } catch (err) {
      console.error('initializeCallKeep error:', err.message);
    }

    // Add RNCallKit Events
    RNCallKeep.addEventListener('didReceiveStartCallAction', this.onNativeCall);
    RNCallKeep.addEventListener('answerCall', this.onAnswerCallAction);
    RNCallKeep.addEventListener('endCall', this.onEndCallAction);
    RNCallKeep.addEventListener('didDisplayIncomingCall', this.onIncomingCallDisplayed);
    RNCallKeep.addEventListener('didPerformSetMutedCallAction', this.onToggleMute);
  };

  authenticate = () => {
    const { server, username, password } = this.state;
    const apiClient = new WazoApiClient({ server });

    apiClient.auth
      .logIn({ username, password })
      .then(data => {
        const userToken = data.token;

        apiClient.confd
          .getUser(userToken, data.uuid)
          .then(user => {
            const line = user.lines[0];

            apiClient.confd
              .getUserLineSip(data.token, data.uuid, line.id)
              .then(sipLine => {
                this.initializeWebRtc(sipLine, server);
                this.initializeCallKeep();
              })
              .catch(console.log);
          })
          .catch(console.log);
      })
      .catch(console.log);
  };

  initializeWebRtc = (sipLine, host) => {
    this.webRtcClient = new WazoWebRTCClient({
      host,
      displayName: 'My dialer',
      authorizationUser: sipLine.username,
      password: sipLine.secret,
      uri: sipLine.username + '@' + host,
      media: {
        audio: true,
      },
    });

    this.webRtcClient.on('invite', session => {
      this.setupCallSession(session);
      this.setState({ ringing: true });

      // Tell callkit that we a call is incoming
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

    this.webRtcClient.answer(this.currentSession);
  };

  hangup = () => {
    const currentCallId = this.getCurrentCallId();
    if (!this.currentSession || !currentCallId) {
      return;
    }

    this.webRtcClient.hangup(this.currentSession);

    RNCallKeep.endCall(currentCallId);
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

  onIncomingCallDisplayed = error => {
    // You will get this event after RNCallKeep finishes showing incoming call UI
    // You can check if there was an error while displaying
  };

  onNativeCall = ({ handle }) => {
    console.log('onNativeCall', handle);
    // Called when performing call from native Contact app
    this.call(handle);
  };

  onEndCallAction = ({ callUUID }) => {
    this.hangup();
  };

  onToggleMute = (muted) => {
    // Called when the system or the user mutes a call
    this.webRtcClient[muted ? 'mute' : 'unmute'](this.currentSession);
  };

  render() {
    const { connected, server } = this.state;

    return (
      <View style={styles.container}>
        {!connected && (
          <React.Fragment>
            <TextInput autoCapitalize="none" onChangeText={username => this.setState({ username })} placeholder="Username" value={this.state.username} />
            <TextInput autoCapitalize="none" onChangeText={password => this.setState({ password })} placeholder="Password" value={this.state.password} />
            <TextInput autoCapitalize="none" defaultValue={server} onChangeText={server => this.setState({ server })} placeholder="Server" />

            <TouchableOpacity onPress={this.authenticate.bind(this)} style={styles.button}>
              <Text>Login</Text>
            </TouchableOpacity>
          </React.Fragment>
        )}

        {connected && (
          <React.Fragment>
            <TextInput
              autoCapitalize="none"
              keyboardType="numeric"
              onChangeText={number => this.setState({ number })}
              onSubmitEditing={this.call.bind(this)}
              placeholder="Number"
              value={this.state.number}
            />

            {!this.state.ringing && !this.state.inCall && (
              <TouchableOpacity onPress={() => this.call(this.state.number)} style={styles.button}>
                <Text>Call</Text>
              </TouchableOpacity>
            )}
            {this.state.ringing && (
              <TouchableOpacity onPress={this.answer} style={styles.button}>
                <Text>Answer</Text>
              </TouchableOpacity>
            )}
            {this.state.inCall && (
              <TouchableOpacity onPress={this.hangup} style={styles.button}>
                <Text>Hangup</Text>
              </TouchableOpacity>
            )}
          </React.Fragment>
        )}
      </View>
    );
  }

}
