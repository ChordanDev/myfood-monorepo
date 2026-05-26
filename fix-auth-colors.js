const fs = require('fs');
const glob = require('glob');

// Map of auth hex colors to theme tokens
const colorMap = {
  '#111309': 'theme.colorBlack',
  '#191D0D': 'theme.colorDark',
  '#242B12': 'theme.colorMedium',
  '#F7F2E8': 'theme.textBlack',
  '#D8D98B': 'theme.primaryAccent',
  '#8A1F1F': "theme.textMedium // error fallback", // we will replace this properly
  '#899064': 'theme.colorLight',
  '#2d3519': 'theme.colorMedium',
  '#E5D8C4': 'theme.icon',
  '#6F735E': 'theme.textLight',
  '#4A5130': 'theme.textMedium',
  '#F6ECDE': 'theme.icon',
};
console.log("We'll manually edit auth since they're heavily using Tailwind literal classes");
