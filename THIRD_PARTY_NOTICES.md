# Third-party notices

Workstel is proprietary (see [LICENSE](LICENSE)). It uses the open-source components below, each under its own licence. Their licence texts are included in each package under `node_modules/` after `npm ci`.

## Bundled in the web application

| Component                                                        | Version | Licence    | Use                      |
| ---------------------------------------------------------------- | ------- | ---------- | ------------------------ |
| [Vue](https://vuejs.org/)                                        | 3.5.44  | MIT        | UI framework             |
| [Vue Router](https://router.vuejs.org/)                          | 4.6.4   | MIT        | Page routing             |
| [Vuetify](https://vuetifyjs.com/)                                | 4.3.1   | MIT        | Material UI components   |
| [Supabase JS](https://github.com/supabase/supabase-js)           | 2.118.0 | MIT        | Auth and database client |
| [Material Design Icons](https://pictogrammers.com/library/mdi/)  | 7.4.47  | Apache-2.0 | Icon font (`@mdi/font`)  |
| [Quicksand](https://fontsource.org/fonts/quicksand) (Fontsource) | 5.3.0   | OFL-1.1    | Interface font           |
| [Noto Sans](https://fontsource.org/fonts/noto-sans) (Fontsource) | 5.3.0   | OFL-1.1    | Table font               |

Versions are those recorded in `package-lock.json` at the time of writing; update this table when a dependency changes.

## Build and development tools

Vite, TypeScript, ESLint, Prettier and the other `devDependencies` in `package.json` are used to build and check the code and are not shipped in the application. Vite and most of these tools are MIT-licensed; TypeScript is Apache-2.0.

## Licence summaries

- **MIT**: use, copy, modify and distribute freely, keeping the copyright and permission notice.
- **Apache-2.0**: like MIT, with an express patent licence; keep the licence and any NOTICE file, and mark modified files.
- **SIL Open Font License 1.1 (OFL-1.1)**: fonts may be used, bundled and embedded, including in commercial software; they may not be sold on their own, and modified versions may not use the reserved font name.

These summaries are for orientation only; the licence texts govern.
