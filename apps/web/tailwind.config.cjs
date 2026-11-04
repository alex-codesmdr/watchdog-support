module.exports = {
  presets: [require('@wd/ui/tailwind-preset')],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  darkMode: ['variant', ['@media (prefers-color-scheme: dark) { &:not([data-theme=light] *) }', '&:is([data-theme=dark] *)']],
};
