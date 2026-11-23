module.exports = ({ config }) => {
  const androidKey = process.env.VESTIGIA_MAPS_ANDROID_KEY;
  const iosKey = process.env.VESTIGIA_MAPS_IOS_KEY;
  return {
    ...config,
    name: 'Vestigia',
    slug: 'vestigia',
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
      ['expo-location', {
        locationWhenInUsePermission: 'Allow Vestigia to locate your city and record walks you start.',
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
    extra: { googleMapsAndroid: Boolean(androidKey), googleMapsIos: Boolean(iosKey) },
  };
};
