module.exports = ({ config }) => {
  const androidKey = process.env.VESTIGIA_MAPS_ANDROID_KEY;
  const iosKey = process.env.VESTIGIA_MAPS_IOS_KEY;
  const outdoorPreview = process.env.VESTIGIA_EXPO_GO_OUTDOORS === '1';
  return {
    ...config,
    name: outdoorPreview ? 'Vestigia Outdoors' : 'Vestigia',
    slug: outdoorPreview ? 'vestigia-outdoors' : 'vestigia',
    scheme: 'vestigia',
    orientation: 'portrait',
    android: {
      package: 'com.vestigia.city',
      config: androidKey ? { googleMaps: { apiKey: androidKey } } : {},
    },
    ios: {
      bundleIdentifier: 'com.vestigia.city',
      config: iosKey ? { googleMapsApiKey: iosKey } : {},
    },
    plugins: [
      ['expo-navigation-bar', {hidden:true}],
      ['expo-location', {
        locationWhenInUsePermission: 'Allow Vestigia to locate your city and track walking while you use the app.',
        locationAlwaysAndWhenInUsePermission: 'Allow Vestigia to record your active walk when the screen is locked.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      }],
      ...(androidKey || iosKey ? [['react-native-maps', {
        androidGoogleMapsApiKey: androidKey,
        iosGoogleMapsApiKey: iosKey,
      }]] : []),
    ],
    extra: { googleMapsAndroid: Boolean(androidKey), googleMapsIos: Boolean(iosKey), outdoorPreview },
  };
};
