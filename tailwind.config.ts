import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: '#212121',
        chat: {
          bg: 'var(--chat-bg)',
          surface: 'var(--chat-surface)',
          'surface-2': 'var(--chat-surface-2)',
          border: 'var(--chat-border)',
          text: 'var(--chat-text)',
          muted: 'var(--chat-muted)',
          accent: 'var(--chat-accent)',
        },
      },
      fontFamily: {
        sans: ['var(--font-chat)', 'Segoe UI', 'sans-serif'],
      },
      maxWidth: {
        chat: '48rem',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
};

export default config;
