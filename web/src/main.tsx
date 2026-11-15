import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@fontsource-variable/asta-sans';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import koKR from '@astryxdesign/core/locales/ko-KR.generated.js';
import {Theme} from '@astryxdesign/core/theme';
import {themes, defaultThemeSlug} from './astryx-themes';
import App from './App';
import {connectHost} from './native/host';
import {applyUiScale} from './ui/scale';

applyUiScale();
connectHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InternationalizationProvider locale="ko-KR" messages={{'ko-KR': koKR}}>
      <Theme theme={themes[defaultThemeSlug]}>
        <App />
      </Theme>
    </InternationalizationProvider>
  </StrictMode>,
);
