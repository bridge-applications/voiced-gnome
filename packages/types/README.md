# Voiced Gnome types

Runtime Zod schemas, inferred TypeScript types and the character/wardrobe catalog shared by the Voiced Gnome browser client and Cloudflare Worker. The package ships compiled ESM and declarations; it does not include artwork, audio, credentials or provider configuration.

```ts
import {
  CHARACTERS,
  ConfigSchema,
  type AppConfig,
} from '@bridge-applications/voiced-gnome-types';

const config: AppConfig = ConfigSchema.parse(response);
const pirate = CHARACTERS.find((character) => character.id === 'pirate');
```

Install from GitHub Packages with registry authentication, including when visibility is public:

```sh
npm install @bridge-applications/voiced-gnome-types
```

Configure `@bridge-applications:registry=https://npm.pkg.github.com` in the consuming project's `.npmrc`. Keep the read token in the user's npm configuration or CI secret, never in source. See [GitHub's npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

Source and development instructions: [bridge-applications/voiced-gnome](https://github.com/bridge-applications/voiced-gnome).
