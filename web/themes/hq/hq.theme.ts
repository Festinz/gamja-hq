// The hq theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in hq.settings.json and the generated hq.settings.ts;
// change them with `astryx experimental theme editor set hq ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {hqSettings} from './hq.settings';

export const hqTheme = defineTheme({
  extends: hqSettings,
  name: 'hq',
});
