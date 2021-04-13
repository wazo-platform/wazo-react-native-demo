# wazo-react-native-demo
A simple demonstration of Wazo's SDK with React Native


## Development

### Issues
To fix react build.

- Go to xcode, add scheme React. Product, schemes, manage schemes and add React.

To fix glog build.

```sh
cd node_modules/react-native/third-party/glog-0.3.4
sh ../../scripts/ios-configure-glog.sh
```

#### WebRTC.framework/WebRTC' does not contain bitcode.

Run :
```sh
yarn download-webrtc-bitecode
```

