import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import { en, id } from 'vuetify/locale';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource/quicksand/400.css';
import '@fontsource/quicksand/500.css';
import '@fontsource/quicksand/600.css';
import '@fontsource/quicksand/700.css';
import '@fontsource/noto-sans/400.css';
import './styles.css';
import './responsive.css';
import './shared/stack-table.css';
import './shared/list-row.css';
import './shared/dialog-phone.css';
import { dialogWidth } from './shared/dialog-widths';
import App from './App.vue';
import { router } from './router';
const vuetify = createVuetify({
  locale: { locale: 'en', fallback: 'en', messages: { en, id } },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: 'workstel',
    themes: {
      workstel: {
        dark: false,
        colors: {
          primary: '#0096C7',
          background: '#F2F5F8',
          surface: '#FFFFFF',
          'on-surface': '#333333',
        },
      },
    },
  },
  defaults: {
    VCard: { rounded: 'sm', elevation: 2 },
    VBtn: { rounded: 'sm', height: 36 },
    VTextField: { variant: 'filled', density: 'compact', hideDetails: 'auto' },
    VSelect: { variant: 'filled', density: 'compact', hideDetails: 'auto' },
    VTextarea: { variant: 'filled', density: 'compact', hideDetails: 'auto' },
    VAutocomplete: { variant: 'filled', density: 'compact', hideDetails: 'auto' },
    VDialog: { maxWidth: dialogWidth.base },
  },
});
const app = createApp(App).use(vuetify).use(router);
void router.isReady().then(() => app.mount('#root'));
