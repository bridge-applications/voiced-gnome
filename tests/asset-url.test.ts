import { describe, expect, it } from 'vitest';
import { withAssetBase } from '../apps/client/src/assetUrl';
describe('deployment asset paths', () => {
  it('preserves standalone paths and prefixes portfolio recordings and wardrobe assets', () => {
    expect(withAssetBase('/', '/gnome/gnome.json')).toBe('/gnome/gnome.json');
    expect(
      withAssetBase('/interactive/voiced-gnome/', '/introductions/royal.mp3'),
    ).toBe('/interactive/voiced-gnome/introductions/royal.mp3');
    expect(
      withAssetBase(
        '/interactive/voiced-gnome/',
        'gnome/wardrobe/hat-hat_001.atlas',
      ),
    ).toBe('/interactive/voiced-gnome/gnome/wardrobe/hat-hat_001.atlas');
  });
});
