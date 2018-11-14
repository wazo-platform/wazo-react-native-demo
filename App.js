import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, TextInput } from 'react-native';

import {
  RTCPeerConnection,
  RTCSessionDescription,
  MediaStream,
  getUserMedia,
} from 'react-native-webrtc';

import { WazoApiClient, WazoWebRTCClient } from '@wazo/sdk';

// Polyfill WebRTC
global.MediaStream = MediaStream;
global.RTCSessionDescription = RTCSessionDescription;
global.RTCPeerConnection = RTCPeerConnection;
global.navigator.mediaDevices = {
  ...global.navigator.mediaDevices,
  getUserMedia: getUserMedia,
};

export default class App extends React.Component {
  constructor(props) {
    super(props);

    this.webRtcClient = null;

    this.state = {
      server: 'demo.wazo.community',
      username: '',
      password: '',
      number: '',
      connected: false
    }
  }
  
  authenticate() {
    const { server, username, password } = this.state;
    const apiClient = new WazoApiClient({ server });

    apiClient.auth.logIn({ username, password }).then((data) => {
      const userToken = data.token;

      apiClient.confd.getUser(userToken, data.uuid).then((user) => {
        const line = user.lines[0];

        console.log('user connected', line);

        apiClient.confd.getUserLineSip(data.token, data.uuid, line.id).then((sipLine) => {
          this.initializeWebRtc(sipLine, server);
        }).catch(console.log);
      }).catch(console.log);
    }).catch(console.log);
  };

  initializeWebRtc(sipLine, host) {
    this.webRtcClient = new WazoWebRTCClient({
      host,
      displayName: 'My dialer',
      authorizationUser: sipLine.username,
      password: sipLine.secret,
      uri: sipLine.username + '@' + host,
      media: {
        audio: true
      }
    });

    this.webRtcClient.on('invite', (session) => {
      try {
        this.webRtcClient.answer(session);
      }catch (e) {
        console.log('invite error', e);
      }
    });

    this.webRtcClient.on('*', function (data, eventName) {
      console.log('rtc', eventName, data);
    });

    this.setState({ connected: true });
  };
  
  call() {
    this.webRtcClient.call(this.state.number);
  }

  render() {
    const { connected, server } = this.state;

    return (
      <View style={styles.container}>
        {!connected && (
          <React.Fragment>
            <TextInput
              autoCapitalize="none"
              onChangeText={(username) => this.setState({ username })}
              value={this.state.username}
              placeholder="Username"
            />
            <TextInput
              autoCapitalize="none"
              onChangeText={(password) => this.setState({ password })}
              value={this.state.password}
              placeholder="Password"
            />
            <TextInput
              autoCapitalize="none"
              defaultValue={server}
              onChangeText={(server) => this.setState({ server })}
              placeholder="Server"
            />

            <TouchableOpacity onPress={this.authenticate.bind(this)}><Text>Login</Text></TouchableOpacity>
          </React.Fragment>
        )}

        {connected && (
          <React.Fragment>
            <TextInput
              autoCapitalize="none"
              keyboardType="numeric"
              onChangeText={(number) => this.setState({ number })}
              onSubmitEditing={this.call.bind(this)}
              value={this.state.number}
              placeholder="Number"
            />

            <TouchableOpacity onPress={this.call.bind(this)}><Text>Call</Text></TouchableOpacity>
          </React.Fragment>
        )}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
