// Config Tailwind para NativeWind en Expo.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './src/**/*.{js,ts,tsx}'],

  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        montserrat: ['Montserrat_400Regular'],
        'montserrat-semibold': ['Montserrat_600SemiBold'],
        'montserrat-bold': ['Montserrat_700Bold'],
        'montserrat-extrabold': ['Montserrat_800ExtraBold'],
        'montserrat-alt-bold': ['MontserratAlternates_700Bold'],
        'montserrat-alt-black': ['MontserratAlternates_900Black'],
        inter: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
      },
    },
    plugins: [],
  },
};
