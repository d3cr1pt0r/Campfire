# Campfire application icon

The current Campfire mark is an amber flame and speech bubble above crossed logs on an espresso rounded-square tile. It has transparent outer corners.

- `campfire/icon-512.png`: final 512 × 512 RGBA source for the current branding.
- `../electron/icons/campfire.png` and `../electron/icons/campfire.ico`: desktop exports.
- `../src/assets/campfire-icon.png`: renderer icon.
- `../src/assets/favicon.png`: browser favicon.

The built-in image generation tool created the mark; Sharp resized the PNG and encoded the ICO. See [the design review](../Docs/campfire-review/README.md#image-generation) for the generation and transparency edit prompts.

`icon-source.png` and the generic `../electron/icons/icon.png` and `icon.ico` paths preserve the earlier icon used by the original-layout design comparisons. Current desktop builds use the Campfire exports above.
