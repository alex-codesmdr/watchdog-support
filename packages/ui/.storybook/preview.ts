import type { Preview } from '@storybook/react';
import './storybook.css';

const preview: Preview = {
  parameters: {
    a11y: { test: 'error' },
    backgrounds: {
      default: 'paper',
      values: [
        { name: 'paper', value: '#F4F6F9' },
        { name: 'dark', value: '#0C141F' },
      ],
    },
  },
};
export default preview;
