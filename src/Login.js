import React, { useState, useEffect } from 'react';
import { StyleSheet, Image, View, Platform } from 'react-native';
import { requestNotifications, request, PERMISSIONS } from 'react-native-permissions';
import { Container, Text, Content, Form, Item, Input, Label, Button, Spinner, Footer } from 'native-base';
import Wazo from '@wazo/sdk/lib/simple';
import AsyncStorage from '@react-native-community/async-storage';
import VoipPushNotification from "react-native-voip-push-notification";
import getApiClient from "@wazo/sdk/lib/service/getApiClient";

const isIOS = Platform.OS === 'ios';

const styles = StyleSheet.create({
  container: {
    paddingTop: 50,
  },
  logoContainer: {
   textAlign: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 200,
    height: 200,
    flex: 1,
  },
  button: {
    flex: 1,
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
  footer: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  error: {
    marginTop: 10,
    textAlign: 'center',
    color: '#fc3503',
  },
});

const Login = ({ defaultUsername = '', defaultPassword = '', defaultServer = '', onLogin = () => {} }) => {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState(defaultPassword);
  const [server, setServer] = useState(defaultServer);
  const [error, setError] = useState(null);
  const [authenticating, setAuthenticating] = useState(false);
  let apnsToken;

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    await requestNotifications(['alert', 'sound']);

    if (isIOS) {
      await request( PERMISSIONS.IOS.MICROPHONE);
      await request( PERMISSIONS.IOS.CAMERA);
      VoipPushNotification.requestPermissions();
      VoipPushNotification.addEventListener('register', async (token) => {
        apnsToken = token;
        console.log('setting apnsToken', apnsToken);
      });
    } else {
      await request(PERMISSIONS.ANDROID.READ_PHONE_STATE);
      await request(PERMISSIONS.ANDROID.CALL_PHONE);
      await request(PERMISSIONS.ANDROID.RECORD_AUDIO);
      await request(PERMISSIONS.ANDROID.CAMERA);
    }

    authenticateFromToken();
  };

  const authenticateFromToken = async () => {
    const host = await AsyncStorage.getItem('host');
    const token = await AsyncStorage.getItem('token');
    if (host) {
      setServer(host);
    }
    if (!host || !token) {
      return;
    }

    setAuthenticating(true);
    setError(null);
    Wazo.Auth.init();
    Wazo.Auth.setHost(host);

    const session = await Wazo.Auth.validateToken(token);
    if (session) {
      return authenticationSuccess(session, host);
    }

    setAuthenticating(false);
  };

  const login = async () => {
    setAuthenticating(true);
    setError(null);
    Wazo.Auth.init();
    Wazo.Auth.setHost(server);

    let session;

    try {
      session = await Wazo.Auth.logIn(username, password);
      authenticationSuccess(session, server);
    } catch (e) {
      setError('Authentication failed');
      setAuthenticating(false);
    }
  };

  const authenticationSuccess = async (session, host) => {
    await AsyncStorage.setItem('host', host);
    await AsyncStorage.setItem('token', session.token);

    if (apnsToken) {
      try {
         await getApiClient().auth.removeDeviceToken(session.uuid);
      } catch (_) {
        // Avoid to fail when trying to remove a non-existent token
      }
      await getApiClient().auth.sendDeviceToken(session.session, null, apnsToken);
    }

    // Store information when authenticating from token
    Wazo.Auth.setHost(host);

    setAuthenticating(false);
    onLogin(session);
  };

  return (
    <Container style={styles.container}>
      <Content>
        <View style={styles.logoContainer}>
          <Image
            style={styles.logo}
            source={require('./logo.png')}
          />
        </View>

        <Form>
         <Item stackedLabel>
           <Label>Username</Label>
           <Input
             autoCapitalize="none"
             autoCorrect={false}
             onChangeText={setUsername}
             value={username}
             onSubmitEditing={login}
           />
         </Item>
         <Item stackedLabel>
           <Label>Password</Label>
           <Input
             autoCapitalize="none"
             autoCorrect={false}
             onChangeText={setPassword}
             value={password}
             secureTextEntry
             onSubmitEditing={login}
           />
         </Item>
          <Item stackedLabel>
           <Label>Server</Label>
           <Input
             autoCapitalize="none"
             autoCorrect={false}
             keyboardType={isIOS ? 'url' : 'email-address'}
             value={server}
             onChangeText={setServer}
             onSubmitEditing={login}
           />
         </Item>
        </Form>

        {authenticating && <Spinner color="blue" />}
        {!!error && <Text full style={styles.error}>{error}</Text>}
      </Content>

      <Footer style={styles.footer}>
        <Button full disabled={authenticating} onPress={login} style={styles.button}>
          <Text>Login</Text>
        </Button>
      </Footer>
    </Container>
  );
};

export default Login;
